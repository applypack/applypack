-- RemoteOK ended every description with a paragraph whose tag is "R" and the
-- base64 of the address that fetched the feed: this machine's public IP. New
-- rows are stored without it (fetchers/remoteok.ts:withoutAddressTag); this
-- takes it out of what is already stored — the descriptions, the originals a
-- refresh kept, and the copies screenings took. The "(#R…)" marker it ends
-- with is RemoteOK's alone, so a row pasted from there is cleaned too.
UPDATE "job"
SET "description" = regexp_replace("description", '\s*Please mention the word[^()]*\(#R[A-Za-z0-9+/=]+\)\.?(\s*This is a beta feature to avoid spam applicants\.)?(\s*Companies can search these words to find applicants that read this and see they.re human\.)?', '', 'g')
WHERE "description" LIKE '%Please mention the word%';

UPDATE "job"
SET "descriptionOriginal" = regexp_replace("descriptionOriginal", '\s*Please mention the word[^()]*\(#R[A-Za-z0-9+/=]+\)\.?(\s*This is a beta feature to avoid spam applicants\.)?(\s*Companies can search these words to find applicants that read this and see they.re human\.)?', '', 'g')
WHERE "descriptionOriginal" LIKE '%Please mention the word%';

UPDATE "screening"
SET "postingText" = regexp_replace("postingText", '\s*Please mention the word[^()]*\(#R[A-Za-z0-9+/=]+\)\.?(\s*This is a beta feature to avoid spam applicants\.)?(\s*Companies can search these words to find applicants that read this and see they.re human\.)?', '', 'g')
WHERE "postingText" LIKE '%Please mention the word%';
