-- The model's ordering, one row per *word*, not per captured line.
--
-- It lives beside `mining_queue` rather than in it because the two are keyed
-- differently: a captured line holds several unjudged words, and each is
-- ranked on its own merits with its own reason. Held in the line's row, two
-- words sharing a sentence would share one rank and one sentence of
-- justification written about whichever of them the model spoke about last.
--
-- Disposable. Nothing here is an assertion about a word — it is one model's
-- opinion about a shortlist, replaced wholesale by the next ranking and
-- meaningless once the candidate is resolved.

CREATE TABLE IF NOT EXISTS mining_queue_ranks (
    entry_id INTEGER NOT NULL,
    headword TEXT    NOT NULL,
    reading  TEXT    NOT NULL,
    rank     INTEGER NOT NULL,
    reason   TEXT,

    PRIMARY KEY (entry_id, headword, reading)
);
