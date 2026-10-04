"""Candidate (my microphone) ASR worker.

Transcribes what the candidate actually says, attaches it to the matching QA
pair for review and follow-up context, and never triggers answer generation.
"""

import threading
import time
import uuid
from difflib import SequenceMatcher

from core.config import get_config
from core.logger import get_interview_logger, get_logger
from core.session import conversation_lock, get_session
from services.audio import AudioCapture, VADBuffer
from services.stt import (
    get_stt_engine,
    postprocess_interview_transcription,
    transcribe_with_fallback,
    transcription_for_publish,
)
from api.realtime.ws import broadcast
from api.assist.knowledge_queue import _submit_candidate_knowledge_update
from api.assist.loop_control import (
    _iter_vad_feed_chunks,
    _pause_event,
    _stop_capture_compat,
    _stop_event,
)

_ilog = get_interview_logger()
_elog = get_logger("pipeline")

_candidate_audio_capture = AudioCapture()
_candidate_flush_event = threading.Event()
_candidate_whisper_preload_lock = threading.Lock()
_candidate_whisper_preload_inflight: set[tuple[str, str]] = set()


def _candidate_provider_config(cfg) -> tuple[str, str, str, bool]:
    provider = (getattr(cfg, "candidate_stt_provider", "whisper") or "whisper").strip()
    allow_remote = bool(getattr(cfg, "candidate_remote_stt_enabled", False))
    if provider in ("doubao", "generic") and not allow_remote:
        provider = "whisper"
    model = (getattr(cfg, "candidate_whisper_model", "") or getattr(cfg, "whisper_model", "base") or "base").strip()
    candidate_lang_raw = (getattr(cfg, "candidate_whisper_language", "") or "").strip()
    language = candidate_lang_raw or (getattr(cfg, "whisper_language", "auto") or "auto").strip() or "auto"
    return provider, model, language, allow_remote


def _candidate_streaming_config(cfg, provider: str) -> tuple[bool, int]:
    enabled = bool(getattr(cfg, "candidate_streaming_asr_enabled", True)) and provider == "whisper"
    interval_ms = max(800, min(5000, int(getattr(cfg, "candidate_streaming_asr_interval_ms", 1500) or 1500)))
    return enabled, interval_ms


def _preload_candidate_whisper_async(provider: str, model: str, language: str) -> None:
    if provider != "whisper":
        return
    preload_key = (model or "base", language or "auto")
    with _candidate_whisper_preload_lock:
        if preload_key in _candidate_whisper_preload_inflight:
            return
        _candidate_whisper_preload_inflight.add(preload_key)

    def _load() -> None:
        try:
            try:
                engine = get_stt_engine(
                    provider="whisper",
                    model_size=model,
                    language=language,
                )
            except TypeError:
                engine = get_stt_engine(model_size=model, language=language)
            if not engine.is_loaded:
                engine.load_model()
            broadcast(
                {
                    "type": "candidate_asr_status",
                    "loaded": bool(engine.is_loaded),
                    "loading": False,
                    "provider": "whisper",
                }
            )
        except Exception as exc:
            _elog.warning(
                "CANDIDATE_ASR_PRELOAD_FAIL model=%s language=%s err=%s",
                model,
                language,
                exc,
            )
            broadcast(
                {
                    "type": "candidate_asr_status",
                    "loaded": False,
                    "loading": False,
                    "provider": "whisper",
                    "error": str(exc)[:160],
                }
            )
        finally:
            with _candidate_whisper_preload_lock:
                _candidate_whisper_preload_inflight.discard(preload_key)

    threading.Thread(target=_load, daemon=True, name="candidate-whisper-preload").start()


def preload_candidate_asr_if_enabled() -> None:
    cfg = get_config()
    if not bool(getattr(cfg, "candidate_asr_enabled", False)):
        return
    provider, model, language, _allow_remote = _candidate_provider_config(cfg)
    if provider != "whisper":
        return
    broadcast({"type": "candidate_asr_status", "loaded": False, "loading": True, "provider": "whisper"})
    _preload_candidate_whisper_async(provider, model, language)


def _publish_candidate_transcription(
    session,
    text: str,
    provider: str,
    qa_id: str = "",
    *,
    segment_id: str = "",
    is_final: bool = True,
) -> None:
    cleaned = (text or "").strip()
    if not cleaned:
        return
    recent_interviewer = session.transcription_history[-3:]
    for item in recent_interviewer:
        interviewer_text = (item or "").strip()
        if len(cleaned) < 12 or len(interviewer_text) < 12:
            continue
        threshold = 0.95 if len(cleaned) < 30 else 0.88
        similarity = SequenceMatcher(None, cleaned, interviewer_text).ratio()
        if similarity >= threshold:
            _ilog.info("CANDIDATE_ASR_SKIP_ECHO ratio=%.2f text=%r", similarity, cleaned[:80])
            return
    with conversation_lock:
        segment = session.add_candidate_transcription(
            cleaned,
            qa_id=qa_id,
            provider=provider,
            segment_id=segment_id,
            is_final=is_final,
        )
    if segment is None:
        return
    if segment.is_final and segment.qa_id:
        with conversation_lock:
            candidate_answer = session.get_candidate_answer_for_qa(segment.qa_id, max_chars=2400)
        if candidate_answer:
            _submit_candidate_knowledge_update(segment.qa_id, candidate_answer)
    _ilog.info(
        "CANDIDATE_ASR_PUBLISH segment=%s qa_id=%s final=%s provider=%s chars=%d",
        segment.segment_id,
        segment.qa_id,
        segment.is_final,
        provider,
        len(cleaned),
    )
    broadcast(
        {
            "type": "candidate_transcription",
            "scope": "assist",
            "text": cleaned,
            "qa_id": segment.qa_id,
            "provider": provider,
            "segment_id": segment.segment_id,
            "is_final": segment.is_final,
        }
    )


def _candidate_worker():
    cfg = get_config()
    provider, model, language, allow_remote = _candidate_provider_config(cfg)
    streaming_enabled, streaming_interval_ms = _candidate_streaming_config(cfg, provider)
    _ilog.info(
        "CANDIDATE_ASR_WORKER_START provider=%s model=%s language=%s remote=%s streaming=%s interval_ms=%d",
        provider,
        model,
        language,
        allow_remote,
        streaming_enabled,
        streaming_interval_ms,
    )
    broadcast({"type": "candidate_asr_status", "loaded": False, "loading": provider == "whisper", "provider": provider})
    _preload_candidate_whisper_async(provider, model, language)

    vad = VADBuffer(
        sample_rate=AudioCapture.SAMPLE_RATE,
        silence_threshold=getattr(cfg, "silence_threshold", 0.01),
        silence_duration=getattr(cfg, "silence_duration", 1.2),
    )
    session = get_session()
    interview_id = getattr(session, "interview_id", None)
    current_segment_id = ""
    current_segment_qa_id = ""
    last_partial_at = 0.0
    last_partial_text = ""

    def _is_current_interview() -> bool:
        return getattr(session, "interview_id", None) == interview_id

    def _ensure_candidate_segment() -> None:
        nonlocal current_segment_id, current_segment_qa_id
        with conversation_lock:
            if current_segment_id or not _is_current_interview():
                return
            current_segment_id = f"cand-{uuid.uuid4().hex}"
            current_segment_qa_id = getattr(session, "current_candidate_qa_id", "")
            if hasattr(session, "mark_candidate_asr_busy"):
                session.mark_candidate_asr_busy(current_segment_qa_id)
        _ilog.info("CANDIDATE_ASR_SEGMENT_START segment=%s qa_id=%s", current_segment_id, current_segment_qa_id)

    def _finalize_candidate_audio(final_audio, log_kind: str) -> None:
        nonlocal current_segment_id, current_segment_qa_id, last_partial_text, last_partial_at
        if not _is_current_interview():
            return
        if final_audio is None or len(final_audio) <= AudioCapture.SAMPLE_RATE * 0.3:
            current_segment_id = ""
            current_segment_qa_id = ""
            last_partial_text = ""
            last_partial_at = 0.0
            with conversation_lock:
                if hasattr(session, "mark_candidate_asr_idle"):
                    session.mark_candidate_asr_idle()
            return
        _ensure_candidate_segment()
        local_cfg = get_config()
        final_provider, final_model, final_language, final_allow_remote = _candidate_provider_config(local_cfg)
        try:
            with conversation_lock:
                if not _is_current_interview():
                    return
                target_qa_id = current_segment_qa_id
                if hasattr(session, "mark_candidate_asr_busy"):
                    session.mark_candidate_asr_busy(target_qa_id)
            t0 = time.monotonic()
            text = transcribe_with_fallback(
                final_audio,
                AudioCapture.SAMPLE_RATE,
                position=local_cfg.position,
                language=final_language,
                provider=final_provider,
                whisper_model=final_model,
                whisper_language=final_language,
                allow_remote=final_allow_remote,
                status_event_type="candidate_asr_status",
                scope="candidate",
                # Final audio must wait for shared Whisper inference. Partials
                # below may skip a busy lock because a final will replace them.
                whisper_lock_timeout_sec=None,
            )
            pub = transcription_for_publish(
                postprocess_interview_transcription(text),
                max(3, int(getattr(local_cfg, "transcription_min_sig_chars", 2) or 2)),
            )
            if pub and _is_current_interview():
                replaced_partial = bool(current_segment_id and last_partial_text)
                _ilog.info(
                    "CANDIDATE_ASR_%s segment=%s qa_id=%s provider=%s raw=%.1fs stt=%.0fms chars=%d replaced_partial=%s text=%r",
                    log_kind,
                    current_segment_id,
                    target_qa_id,
                    final_provider,
                    len(final_audio) / AudioCapture.SAMPLE_RATE,
                    (time.monotonic() - t0) * 1000,
                    len(pub),
                    replaced_partial,
                    pub[:120],
                )
                with conversation_lock:
                    if _is_current_interview():
                        _publish_candidate_transcription(
                            session,
                            pub,
                            final_provider,
                            qa_id=target_qa_id,
                            segment_id=current_segment_id,
                            is_final=True,
                        )
                broadcast({"type": "candidate_asr_status", "loaded": True, "loading": False, "provider": final_provider})
        except Exception as e:
            _elog.error("Candidate ASR transcribe error: %s", e, exc_info=True)
            broadcast({"type": "candidate_asr_status", "loaded": False, "loading": False, "provider": final_provider, "error": str(e)[:160]})
        finally:
            with conversation_lock:
                if _is_current_interview() and hasattr(session, "mark_candidate_asr_idle"):
                    session.mark_candidate_asr_idle()
            current_segment_id = ""
            current_segment_qa_id = ""
            last_partial_text = ""
            last_partial_at = 0.0

    try:
        while not _stop_event.is_set() and _is_current_interview():
            if _pause_event.is_set():
                if _candidate_flush_event.is_set():
                    _candidate_flush_event.clear()
                    _finalize_candidate_audio(vad.flush(), "PAUSE_FINAL")
                time.sleep(0.1)
                continue
            chunks = _candidate_audio_capture.drain_audio_chunks(timeout=0.1, max_chunks=6)
            if not _is_current_interview():
                break
            if not chunks:
                time.sleep(0.05)
                continue

            cfg = get_config()
            if not bool(getattr(cfg, "candidate_asr_enabled", False)):
                with conversation_lock:
                    if hasattr(session, "mark_candidate_asr_idle"):
                        session.mark_candidate_asr_idle()
                continue

            pending_audio = None
            for chunk in chunks:
                for vad_chunk in _iter_vad_feed_chunks(chunk):
                    if not _is_current_interview():
                        break
                    flushed = vad.feed(vad_chunk)
                    if flushed is not None or getattr(vad, "has_pending_audio", False):
                        _ensure_candidate_segment()
                    if flushed is not None:
                        _finalize_candidate_audio(flushed, "FINAL")
            if not _is_current_interview():
                break
            if getattr(vad, "has_pending_audio", False):
                _ensure_candidate_segment()
                with conversation_lock:
                    if hasattr(session, "mark_candidate_asr_busy"):
                        session.mark_candidate_asr_busy(current_segment_qa_id)
                    target_qa_id = current_segment_qa_id
                provider, model, language, allow_remote = _candidate_provider_config(cfg)
                streaming_enabled, streaming_interval_ms = _candidate_streaming_config(cfg, provider)
                now_mono = time.monotonic()
                pending_audio = vad.pending_audio() if hasattr(vad, "pending_audio") else None
                if (
                    streaming_enabled
                    and pending_audio is not None
                    and len(pending_audio) >= AudioCapture.SAMPLE_RATE * 1.0
                    and now_mono - last_partial_at >= streaming_interval_ms / 1000.0
                ):
                    last_partial_at = now_mono
                    try:
                        partial_t0 = time.monotonic()
                        partial_text = transcribe_with_fallback(
                            pending_audio,
                            AudioCapture.SAMPLE_RATE,
                            position=cfg.position,
                            language=language,
                            provider=provider,
                            whisper_model=model,
                            whisper_language=language,
                            allow_remote=False,
                            status_event_type="candidate_asr_status",
                            scope="candidate",
                            whisper_lock_timeout_sec=0.0,
                            whisper_require_loaded=True,
                        )
                        partial_pub = transcription_for_publish(
                            postprocess_interview_transcription(partial_text),
                            max(3, int(getattr(cfg, "transcription_min_sig_chars", 2) or 2)),
                        )
                        if partial_pub and partial_pub != last_partial_text and _is_current_interview():
                            last_partial_text = partial_pub
                            _ilog.info(
                                "CANDIDATE_ASR_PARTIAL segment=%s qa_id=%s provider=%s raw=%.1fs stt=%.0fms chars=%d text=%r",
                                current_segment_id,
                                target_qa_id,
                                provider,
                                len(pending_audio) / AudioCapture.SAMPLE_RATE,
                                (time.monotonic() - partial_t0) * 1000,
                                len(partial_pub),
                                partial_pub[:120],
                            )
                            with conversation_lock:
                                if _is_current_interview():
                                    _publish_candidate_transcription(
                                        session,
                                        partial_pub,
                                        provider,
                                        qa_id=target_qa_id,
                                        segment_id=current_segment_id,
                                        is_final=False,
                                    )
                        elif partial_pub:
                            _ilog.debug(
                                "CANDIDATE_ASR_PARTIAL_DUP segment=%s qa_id=%s chars=%d",
                                current_segment_id,
                                target_qa_id,
                                len(partial_pub),
                            )
                        else:
                            _ilog.debug(
                                "CANDIDATE_ASR_PARTIAL_EMPTY segment=%s qa_id=%s raw=%.1fs",
                                current_segment_id,
                                target_qa_id,
                                len(pending_audio) / AudioCapture.SAMPLE_RATE,
                            )
                    except Exception as exc:
                        _elog.debug("Candidate streaming ASR partial failed: %s", exc)
        remaining = vad.flush()
        if remaining is not None:
            _finalize_candidate_audio(remaining, "FLUSH_FINAL")
    except Exception as e:
        _elog.error("Candidate ASR worker crashed: %s", e, exc_info=True)
        broadcast({"type": "candidate_asr_status", "loaded": False, "loading": False, "provider": provider, "error": str(e)[:160]})
    finally:
        try:
            if _is_current_interview():
                _stop_capture_compat(_candidate_audio_capture, owner="assist-candidate", clear_queue=True)
        except Exception:
            _elog.error("candidate audio_capture.stop failed", exc_info=True)
