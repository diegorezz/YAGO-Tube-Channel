from app.services.analyzer import rank_moments


def test_rank_moments_combines_signals_and_deduplicates():
    scene_ts = [10.0, 12.0, 60.0, 120.0]
    audio_ts = [11.0, 11.5, 61.0]
    action_ts = [10.5, 60.5]

    ranked = rank_moments(
        scene_ts=scene_ts,
        audio_ts=audio_ts,
        action_ts=action_ts,
        cut_length=15.0,
        video_duration=180.0,
        window=5.0,
        max_moments=10,
    )

    assert len(ranked) == 3
    # Highest-scoring cluster around ~11s has 2 scene + 2 audio + 1 action = 4+6+4 = 14
    assert ranked[0].rank == 1
    assert 9.0 <= ranked[0].timestamp <= 13.0
    assert ranked[0].score == 14.0
    assert ranked[0].scene_hits == 2
    assert ranked[0].audio_hits == 2
    assert ranked[0].action_hits == 1
    # Non-overlapping spacing enforced
    assert abs(ranked[0].timestamp - ranked[1].timestamp) >= 9.75


def test_rank_moments_fallback_for_calm_video():
    ranked = rank_moments(
        scene_ts=[],
        audio_ts=[],
        action_ts=[],
        cut_length=15.0,
        video_duration=90.0,
        max_moments=5,
    )
    assert len(ranked) >= 3
    assert ranked[0].start >= 0.0
    assert ranked[-1].end <= 90.0
