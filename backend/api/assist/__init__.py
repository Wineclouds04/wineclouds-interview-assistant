"""实时辅助 Tab：录音、转写、问答、会话状态。"""

from api.assist.routes import router
from api.assist.candidate import preload_candidate_asr_if_enabled
from api.assist.knowledge_queue import init_background_workers, shutdown_background_workers
from api.assist.pipeline import stop_interview_loop

__all__ = [
    "router",
    "stop_interview_loop",
    "init_background_workers",
    "preload_candidate_asr_if_enabled",
    "shutdown_background_workers",
]
