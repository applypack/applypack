-- Stage 3b (plan §4.2): DOU.ua as a source. One Company row per feed query
-- string (category / city / remote / search); the feed is DOU's own
-- interface (utm_source=jobsrss) and is fetched with link-back kept.
ALTER TYPE "AtsType" ADD VALUE 'DOU';
