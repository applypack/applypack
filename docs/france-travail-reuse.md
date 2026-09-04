# How ApplyPack reuses France Travail's job offers

The offers ApplyPack shows from France Travail come from the *Offres
d'emploi v2* API on francetravail.io, under France Travail's
[Licence de réutilisation de la base de données des offres d'emploi](https://francetravail.io/produits-partages/documentation/conditions-dutilisation-api/licence-offres-emploi).
Article 4 of that licence asks a reuser to say what it changed in the data,
or by what method. This page is that statement. ADR 0034 records the
decisions behind it.

## What is stored, and how

- **An offer is stored as received.** The API's JSON for the offer is kept
  whole (`Job.sourcePayload`) and shown whole on the job page ("Full offer
  as published by France Travail"). Nothing in it is rewritten.
- **The description shown is the board's own text**, preceded by one line
  that names the source, the board's last update date and this licence.
  The other lines added in front of it (hiring company, occupation,
  contract, experience, salary, number of positions) repeat fields of the
  same offer in English, so a reader who does not open the full offer still
  sees them; they are copies, not changes.
- **Everything else on a job page is ApplyPack's own annotation**, kept
  apart from the offer: the fit score, the location verdict, the red
  flags, the summary, the user's notes and application record. None of it
  is presented as the board's content.

## How offers are kept current

- Every stored offer is asked about again on francetravail.io **at least
  once every 24 hours** (licence art. 5.2). The daily mirror runs inside
  the hourly fetch and does whatever is due, so a missed hour never becomes
  a missed day. If fetching is paused for longer than a day, that
  obligation lapses; disable the France Travail rows on Companies first.
- An offer the board **modified** is replaced by the board's newer version.
- An offer the board **withdrew** is deleted. If the user had applied to
  it, saved it, or moved it on their application board, the row stays as
  the user's own record with the offer's content removed as art. 7 lists:
  the employer, the contact, the description, the offer's URL and the
  commune are gone; the title and the user's notes remain.

## Who sees it

ApplyPack is a self-hosted tool that serves its owner; its dashboard binds
to the local machine by default. The offers are not made available to
third parties (licence art. 3). Contact details inside an offer are used
to apply and for nothing else (art. 8), and they leave with the offer.
