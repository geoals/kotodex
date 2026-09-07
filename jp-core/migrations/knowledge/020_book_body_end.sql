-- Where the story ends, so an afterword is not part of the book's length.
--
-- The epub runs past the last page of the paper copy: afterword, notes, the
-- next volume's advert. Counted as body they stretch the page estimate and
-- leave a finished book short of 100%. Books added before this end at the end
-- of the file, which is what they were being measured against anyway.
ALTER TABLE books ADD COLUMN body_end INTEGER NOT NULL DEFAULT 0;
UPDATE books SET body_end = text_bytes;
