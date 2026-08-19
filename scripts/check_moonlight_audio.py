#!/usr/bin/env python3
"""Check the Windows WASAPI loopback used by the Moonlight audio path.

Run this on the desktop while Moonlight is playing a known audio source.  The
command only reads audio for a few seconds and prints level measurements; it
does not save or upload a recording.

Examples::

    python scripts/check_moonlight_audio.py --list
    python scripts/check_moonlight_audio.py --duration 5
    python scripts/check_moonlight_audio.py --device 1 --duration 5
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from typing import Any, Iterable, Optional

import numpy as np


SAMPLE_RATE = 16_000
BLOCK_SIZE = 4_096
DEFAULT_DURATION = 3.0
DEFAULT_THRESHOLD = 0.003


def _load_soundcard() -> Any:
    """Import soundcard with an actionable Windows installation message."""
    try:
        import soundcard as soundcard_module
    except Exception as exc:  # pragma: no cover - depends on local install
        raise RuntimeError(
            "未找到 soundcard。请在项目根目录执行："
            "python -m pip install -r backend/requirements.txt"
        ) from exc
    return soundcard_module


def _speaker_label(speaker: Any, default_id: Optional[str], index: int) -> str:
    name = str(getattr(speaker, "name", "(未命名输出设备)") or "(未命名输出设备)")
    speaker_id = str(getattr(speaker, "id", "") or "")
    marker = "★ " if default_id and speaker_id == default_id else "  "
    return f"{marker}[{index}] {name}"


def list_speakers(soundcard_module: Any) -> tuple[list[Any], Optional[str]]:
    """Return all output devices and the current default output id."""
    speakers = list(soundcard_module.all_speakers())
    try:
        default_id = str(soundcard_module.default_speaker().id)
    except Exception:
        default_id = None
    return speakers, default_id


def print_speakers(soundcard_module: Any) -> list[Any]:
    speakers, default_id = list_speakers(soundcard_module)
    if not speakers:
        print("没有发现 Windows 输出设备。请确认声卡驱动和 Moonlight 音频输出正常。")
        return speakers
    print("可用的 WASAPI 输出/环回设备（★ 为当前默认输出）：")
    for index, speaker in enumerate(speakers):
        print(_speaker_label(speaker, default_id, index))
    return speakers


def select_speaker(
    speakers: Iterable[Any],
    selector: Optional[str],
    default_id: Optional[str] = None,
) -> Any:
    """Select a speaker by list index, exact name, or case-insensitive substring."""
    candidates = list(speakers)
    if not candidates:
        raise RuntimeError("没有可用的 WASAPI 输出设备")
    if selector is None or not str(selector).strip():
        if default_id:
            for speaker in candidates:
                if str(getattr(speaker, "id", "")) == default_id:
                    return speaker
        return candidates[0]

    value = str(selector).strip()
    try:
        index = int(value)
    except ValueError:
        index = -1
    if 0 <= index < len(candidates):
        return candidates[index]

    lower_value = value.casefold()
    exact = [
        speaker for speaker in candidates
        if str(getattr(speaker, "name", "")).casefold() == lower_value
    ]
    if exact:
        return exact[0]
    partial = [
        speaker for speaker in candidates
        if lower_value in str(getattr(speaker, "name", "")).casefold()
    ]
    if partial:
        return partial[0]
    raise RuntimeError(f"找不到输出设备 {selector!r}；先运行 --list 查看设备名称和序号")


def measure_loopback(
    soundcard_module: Any,
    speaker: Any,
    duration: float,
) -> tuple[int, float, float]:
    """Capture a short loopback sample and return frames, RMS, and peak."""
    if duration <= 0:
        raise ValueError("duration 必须大于 0")
    microphone = soundcard_module.get_microphone(
        getattr(speaker, "id", None), include_loopback=True
    )
    frame_count = 0
    sum_squares = 0.0
    peak = 0.0
    deadline = time.monotonic() + duration
    with microphone.recorder(
        samplerate=SAMPLE_RATE,
        channels=1,
        blocksize=BLOCK_SIZE,
    ) as recorder:
        while time.monotonic() < deadline:
            data = recorder.record(numframes=BLOCK_SIZE)
            if data is None:
                continue
            samples = np.asarray(data, dtype=np.float32)
            if samples.ndim > 1:
                samples = samples[:, 0]
            samples = samples.reshape(-1)
            if samples.size == 0:
                continue
            frame_count += int(samples.size)
            sum_squares += float(np.dot(samples, samples))
            peak = max(peak, float(np.max(np.abs(samples))))
    rms = math.sqrt(sum_squares / frame_count) if frame_count else 0.0
    return frame_count, rms, peak


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="检测 Moonlight 在 Windows 桌面端的 WASAPI 系统音频环回"
    )
    parser.add_argument(
        "--list", action="store_true", dest="list_only",
        help="只列出输出设备，不采集音频",
    )
    parser.add_argument(
        "--device", help="设备序号，或设备名称（支持名称片段）；默认使用当前系统输出",
    )
    parser.add_argument(
        "--duration", type=float, default=DEFAULT_DURATION,
        help=f"采集秒数，默认 {DEFAULT_DURATION:g}",
    )
    parser.add_argument(
        "--threshold", type=float, default=DEFAULT_THRESHOLD,
        help=f"判定有信号的 RMS 阈值，默认 {DEFAULT_THRESHOLD:g}",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        soundcard_module = _load_soundcard()
        speakers, default_id = list_speakers(soundcard_module)
        if args.list_only:
            print_speakers(soundcard_module)
            return 0 if speakers else 1
        speaker = select_speaker(speakers, args.device, default_id)
        name = str(getattr(speaker, "name", "(未命名输出设备)"))
        print(f"正在监听：{name}（{args.duration:g} 秒）")
        print("请在这段时间内让 Moonlight 播放一段有明显声音的内容……")
        frames, rms, peak = measure_loopback(soundcard_module, speaker, args.duration)
    except (RuntimeError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("已取消。", file=sys.stderr)
        return 130
    except Exception as exc:  # pragma: no cover - hardware/driver dependent
        print(f"采集失败：{exc}", file=sys.stderr)
        return 3

    print(f"采样帧数：{frames}")
    print(f"RMS：{rms:.6f}    Peak：{peak:.6f}")
    if rms >= args.threshold:
        print("结果：检测到音频信号。可在助手中选择该设备的“系统音频”环回。")
        return 0
    print(
        "结果：信号过低。请确认 Moonlight 正在播放声音、未勾选“将目标计算机扬声器静音”，"
        "并选择带 ★ 的当前输出设备。"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

