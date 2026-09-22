-- The mining queue: lines captured speculatively while reading, waiting to be
-- judged into cards or thrown away.
--
-- Local rather than shared, and deliberately so. A pending row is not a fact
-- about what was read — the reading is already in `lines`, counted once by
-- ingest. This is a shortlist of candidates plus the media that would be lost
-- if nobody grabbed it, and it stops existing the moment the row is resolved.
-- Nothing else asks questions of it.
--
-- `line_id` points into knowledge.db and is not a foreign key: the two
-- databases are separate files, and a discarded line should leave a queue row
-- to clean up rather than a dangling constraint.

CREATE TABLE IF NOT EXISTS mining_queue (
    id          INTEGER PRIMARY KEY,
    line_id     INTEGER NOT NULL UNIQUE,
    -- Copied from the line rather than joined: the queue outlives a retracted
    -- line, and the panel must still be able to show what was captured.
    line_ts     REAL    NOT NULL,
    text        TEXT    NOT NULL,
    work        TEXT,
    -- The new/unknown terms that made this line a candidate, as
    -- [{headword, reading, surface, status}]. Frozen at capture — this is the
    -- line as it was met. Whether a word is still worth a card is asked of the
    -- ledger every time the queue is listed, so judging one of these known
    -- takes it out of the panel without rewriting the row, and un-judging it
    -- brings the candidate back.
    terms_json  TEXT    NOT NULL DEFAULT '[]',

    -- Absolute paths under the media directory. Either may be missing: an
    -- unvoiced line has no audio, and a failed screenshot is not a failed
    -- capture.
    audio_path  TEXT,
    image_path  TEXT,

    -- pending | promoted | discarded
    status      TEXT    NOT NULL DEFAULT 'pending',

    captured_ts REAL    NOT NULL,
    resolved_ts REAL
);

-- The ranking is per word, not per line, so it lives in
-- `mining_queue_ranks` — see 005.

CREATE INDEX IF NOT EXISTS idx_mining_queue_pending
    ON mining_queue(status, line_ts);
