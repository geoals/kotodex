CREATE TABLE IF NOT EXISTS primer_words (
    job_id            INTEGER NOT NULL REFERENCES mining_jobs(id),
    headword          TEXT NOT NULL,
    reading           TEXT NOT NULL,
    pos               TEXT NOT NULL,
    count             INTEGER NOT NULL,
    first_sentence_id INTEGER NOT NULL REFERENCES mining_sentences(id),
    first_start       REAL NOT NULL,
    first_offset      INTEGER NOT NULL,
    first_len         INTEGER NOT NULL,
    freq_rank         INTEGER,
    bccwj_rank        INTEGER,
    times             TEXT NOT NULL,
    PRIMARY KEY (job_id, headword, reading)
);

CREATE INDEX IF NOT EXISTS idx_primer_words_job ON primer_words(job_id);

CREATE TABLE IF NOT EXISTS primer_minutes (
    job_id         INTEGER NOT NULL REFERENCES mining_jobs(id),
    minute         INTEGER NOT NULL,
    content_tokens INTEGER NOT NULL,
    PRIMARY KEY (job_id, minute)
);

CREATE TABLE IF NOT EXISTS primer_builds (
    job_id         INTEGER PRIMARY KEY REFERENCES mining_jobs(id),
    sentence_count INTEGER NOT NULL
);
