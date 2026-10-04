"""Background queue that persists answered questions to the knowledge store.

Writes go through a bounded worker thread so a slow SQLite write never stalls
an answer commit.  Before ``init_background_workers()`` (e.g. in scripts and
tests) records are saved synchronously.
"""

from typing import Optional

from core.background import BoundedTaskWorker
from core.logger import get_logger

_elog = get_logger("pipeline")

_knowledge_worker: Optional[BoundedTaskWorker] = None


def init_background_workers():
    global _knowledge_worker
    if _knowledge_worker is None:
        _knowledge_worker = BoundedTaskWorker(
            "assist.knowledge_worker",
            _save_knowledge_record,
            maxsize=64,
        )
    _knowledge_worker.start()


def shutdown_background_workers():
    global _knowledge_worker
    if _knowledge_worker is None:
        return
    _knowledge_worker.stop()


def _submit_knowledge_record(
    question: str,
    answer: str,
    qa_id: str = "",
    candidate_answer: str = "",
) -> bool:
    worker = _knowledge_worker
    if worker is None:
        _save_knowledge_record("save", question, answer, qa_id, candidate_answer)
        return True
    return worker.submit("save", question, answer, qa_id, candidate_answer)


def _submit_candidate_knowledge_update(qa_id: str, candidate_answer: str) -> bool:
    if not (qa_id or "").strip() or not (candidate_answer or "").strip():
        return False
    worker = _knowledge_worker
    if worker is None:
        _save_knowledge_record("candidate_update", qa_id, candidate_answer)
        return True
    return worker.submit("candidate_update", qa_id, candidate_answer)


def _save_knowledge_record(action: str, *args: object):
    try:
        from services.storage.knowledge import save_record, update_candidate_answer_for_qa

        if action == "candidate_update":
            qa_id = str(args[0] if len(args) > 0 else "")
            candidate_answer = str(args[1] if len(args) > 1 else "")
            update_candidate_answer_for_qa(qa_id, candidate_answer)
            return

        question = str(args[0] if len(args) > 0 else "")
        answer = str(args[1] if len(args) > 1 else "")
        qa_id = str(args[2] if len(args) > 2 else "")
        candidate_answer = str(args[3] if len(args) > 3 else "")
        save_record("assist", question, answer, qa_id=qa_id, candidate_answer=candidate_answer)
    except Exception as exc:
        _elog.warning("_save_knowledge_record failed: %s", exc)
