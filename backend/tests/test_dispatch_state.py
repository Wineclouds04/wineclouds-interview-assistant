import random
import threading

from api.assist.dispatch_state import AnswerDispatchState


def _task(origin="manual", asr_turn_id=0, source="system"):
    return ("q", None, False, source, {"origin": origin, "asr_turn_id": asr_turn_id})


def test_enqueue_assigns_increasing_seqs_with_session_version():
    st = AnswerDispatchState()
    assert st.enqueue(_task()) == (0, 0)
    assert st.enqueue(_task()) == (1, 0)
    assert [seq for _, seq, _ in st.pending] == [0, 1]


def test_commits_apply_in_submit_order():
    st = AnswerDispatchState()
    applied = []
    st.flush_commit(2, lambda: applied.append(2))
    st.flush_commit(1, lambda: applied.append(1))
    assert applied == []
    st.flush_commit(0, lambda: applied.append(0))
    assert applied == [0, 1, 2]
    assert st.next_commit_seq == 3


def test_skipped_seq_unblocks_later_commits():
    st = AnswerDispatchState()
    applied = []
    st.flush_commit(1, lambda: applied.append(1))
    st.mark_seq_skipped(0)
    assert applied == [1]


def test_late_commit_for_already_passed_seq_is_dropped():
    st = AnswerDispatchState()
    st.mark_seq_skipped(0)
    applied = []
    st.flush_commit(0, lambda: applied.append(0))
    assert applied == []


def test_reset_discards_work_and_resumes_after_last_submitted_seq():
    st = AnswerDispatchState()
    for _ in range(3):
        st.enqueue(_task())
    applied = []
    st.flush_commit(1, lambda: applied.append("stale"))

    next_seq = st.reset_queue()
    st.reset_commits(next_seq)

    assert st.pending == []
    assert st.session_version == 1
    assert not st.is_session_current(0)
    assert st.is_session_current(1)
    assert st.next_commit_seq == 3
    assert st.is_idle()
    # A worker from the old session finishing now must not commit.
    st.flush_commit(0, lambda: applied.append("stale"))
    assert applied == []
    seq, version = st.enqueue(_task())
    st.flush_commit(seq, lambda: applied.append("fresh"))
    assert (seq, version) == (3, 1)
    assert applied == ["fresh"]


def test_generation_bump():
    st = AnswerDispatchState()
    g0 = st.generation()
    assert st.bump_generation() == g0 + 1
    assert st.generation() == g0 + 1


def test_begin_asr_turn_skips_superseded_pending_asr_tasks():
    st = AnswerDispatchState()
    first = st.begin_asr_turn(interrupt_pending_asr=True)
    st.enqueue(_task(origin="asr", asr_turn_id=first))
    st.enqueue(_task(origin="manual"))
    applied = []
    st.flush_commit(1, lambda: applied.append("manual"))

    second = st.begin_asr_turn(interrupt_pending_asr=True)

    assert second > first
    assert [t[4]["origin"] for t, _, _ in st.pending] == ["manual"]
    # seq 0 (stale ASR) was marked skipped, so the manual answer could commit.
    assert applied == ["manual"]


def test_begin_asr_turn_keeps_pending_when_not_interrupting():
    st = AnswerDispatchState()
    turn = st.begin_asr_turn(interrupt_pending_asr=False)
    st.enqueue(_task(origin="asr", asr_turn_id=turn))
    st.begin_asr_turn(interrupt_pending_asr=False)
    assert len(st.pending) == 1


def test_record_asr_turn_prunes_old_entries():
    st = AnswerDispatchState()
    st.record_asr_turn(0.0)
    st.record_asr_turn(5.0)
    st.record_asr_turn(10.0)
    assert st.recent_asr_turn_monos == [5.0, 10.0]


def test_release_clears_in_flight():
    st = AnswerDispatchState()
    st.in_flight[4] = (0, _task())
    assert not st.is_idle()
    st.release(4)
    assert st.is_idle()


def test_concurrent_out_of_order_commits_apply_in_order():
    st = AnswerDispatchState()
    n = 200
    seqs = [st.enqueue(_task())[0] for _ in range(n)]
    applied: list[int] = []
    order = seqs[:]
    random.Random(1234).shuffle(order)
    barrier = threading.Barrier(8)

    def worker(chunk):
        barrier.wait()
        for seq in chunk:
            if seq % 7 == 0:
                st.mark_seq_skipped(seq)
            else:
                st.flush_commit(seq, lambda s=seq: applied.append(s))

    threads = [threading.Thread(target=worker, args=(order[i::8],)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert applied == [s for s in seqs if s % 7 != 0]
    assert st.next_commit_seq == n
