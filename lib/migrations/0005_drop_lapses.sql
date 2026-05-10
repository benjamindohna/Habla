-- Drop the user_vocab.lapses column. It was incremented on every soft-lapse
-- (chat re-tap) and every test-mode "0" verdict, but never read by any
-- decision logic. The stage drop itself already encodes "the user got it
-- wrong" semantically. looked_up stays — useful for analytics
-- ("which words does this user re-look-up most often?").

ALTER TABLE user_vocab DROP COLUMN lapses;
