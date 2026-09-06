-- A work with an epub knows its own length.
--
-- The epub's body character count is the work's total, so progress and the
-- finish estimate need nothing typed in. Setup writes it from now on; this
-- fills in the books added before it did.
UPDATE works
SET total_chars = (SELECT body_chars FROM books WHERE books.work = works.title)
WHERE total_chars IS NULL
  AND EXISTS (SELECT 1 FROM books WHERE books.work = works.title AND body_chars > 0);
