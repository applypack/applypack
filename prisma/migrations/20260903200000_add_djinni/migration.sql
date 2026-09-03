-- Stage 3b (plan §4.2): Djinni as a source. One Company row per feed filter
-- string (primary_keyword / employment / region); location lives in the
-- filter, not in the items.
ALTER TYPE "AtsType" ADD VALUE 'DJINNI';
