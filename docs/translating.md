# Translating the interface

ApplyPack's interface is written in English and translated from it
([ADR 0061](./adr/0061-the-interface-speaks-several-languages.md)). This page
is for anyone who corrects a wording or adds a language, a later coding
session included: where the words live, how a message is written, and the
terms each language uses.

## What is translated

Everything the code writes for a person: menus, pages, buttons, messages,
the explanations the code builds (why a score is what it is, why a posting
was turned away) and the Telegram and Discord alerts.

Not translated, on purpose:

- anything an AI model writes (a verdict, a suggestion, a review, a
  verification) and the prompts that ask for it;
- your resume, your cover letter and the clean version of a resume;
- a posting's title, company and place, which stay as posted;
- logs, command-line output, CSV values;
- the applicant notice in employer mode, which is a legal text.

## Where the words live

One file per language in `src/i18n/catalog/`: `en.json` is the source,
`uk.json` the Ukrainian. A line is a key and its message:

```json
"ui.removeFilter": "Remove filter: {label}",
```

To correct a wording, change the message in your language's file and open a
pull request. Never change a key, and never translate what is inside
`{braces}` or `<tags>`. `npm test` checks every file against `en.json`: the
same keys, the same `{arguments}` and `<tags>`, and every plural in the forms
your language has.

The languages and where each stands are listed in `src/i18n/locale.ts`:

| Stage | Meaning |
| --- | --- |
| ready | In the switcher. Read by a person who speaks it. |
| beta | In the switcher, labelled "beta": translated by machine from this glossary, not yet read by a native speaker. |
| unfinished | Only under Settings → General → Language → "Unfinished languages": some pages still read in English. |

## How a message is written

| You write | It means |
| --- | --- |
| `{name}` | A value put in as it is. Move it where your grammar wants it. |
| `{n, number}` | A number in your language's grouping (`1,200` / `1 200`). |
| `{n, plural, one {# job} other {# jobs}}` | One branch per plural form of your language; `#` is the number. `=0 {…}` matches zero exactly. |
| `{kind, select, pdf {…} other {…}}` | One branch per value. Keep the branch names. |
| `<link>words</link>` | An inline element (a link, bold). Translate the words, keep the tag, put it where it belongs in your sentence. |
| `'{'` `'}'` `'<'` `'#'` | The character itself. An apostrophe in a word (`don't`, `l'offre`, `обов'язкове`) is written plainly. |

Plural forms per language, as the tests require them:

| Language | Forms |
| --- | --- |
| English, German, Hindi | `one`, `other` |
| Spanish, French | `one`, `many`, `other` (`many` is for millions: "1 000 000 de …") |
| Ukrainian | `one` (1, 21), `few` (2–4, 22), `many` (5–20), `other` (1,5) |

A sentence is one message. Do not build one from pieces: a word that is a
label in one place and the middle of a sentence in another needs two
messages, because most languages decline it.

## Voice

Plain and direct, as the English is: say what happened, what it means and
what to do next. No exclamation marks, no marketing words, no "please" on a
button. Sentence case everywhere: "Tailor resume", not "Tailor Resume".

| Language | Address | Notes |
| --- | --- | --- |
| English | you | The source. |
| Ukrainian | ви (lowercase) | Buttons are infinitives: «Зберегти», «Порівняти». Quotation marks «…». "AI" is «ШІ». Units: с, хв, год, дн. |
| German | du | Buttons are infinitives: „Speichern“. Gender-neutral plurals where one exists („Bewerbende“). "AI" is „KI“. |
| Spanish | tú, never vosotros | Neutral, readable in Spain and Latin America alike: «solicitud», not «postulación» or «candidatura». "AI" is «IA». |
| French | vous | Buttons are infinitives: « Enregistrer ». A narrow no-break space before `:`, `;`, `?`, `!` and inside « ». "AI" is « IA ». |
| Hindi | आप | Everyday tech loanwords stay loanwords, in Devanagari: रेज़्यूमे, अलर्ट, सेटिंग्स. Latin digits. |

Always in Latin script, never translated or transliterated: "ApplyPack";
technology names (PHP, Node.js, PostgreSQL, Docker); vendors and services
(Greenhouse, Telegram, Discord, GitHub, Ollama); model and engine names
(Claude, Gemini, Opus 5); file formats and commands (`.docx`, PDF, CSV,
`npm start`); environment variable names.

Dates, numbers, weekday and country names are not in the catalog at all: the
code asks the language for them (`src/i18n/format.ts`), in Latin digits.

## Glossary

One term, one translation, everywhere. English and Ukrainian are read by the
project's owner. The German, Spanish, French and Hindi columns are the
starting point for their machine translation; a native speaker's correction
replaces a row here first and the catalog second.

| English | Ukrainian | German | Spanish | French | Hindi |
| --- | --- | --- | --- | --- | --- |
| job, posting | вакансія | Stelle, Stellenanzeige | oferta | offre | नौकरी, जॉब पोस्टिंग |
| application | заявка | Bewerbung | solicitud | candidature | आवेदन |
| to apply | подати заявку | sich bewerben | solicitar | postuler | आवेदन करना |
| resume | резюме | Lebenslauf | currículum | CV | रेज़्यूमे |
| cover letter | супровідний лист | Anschreiben | carta de presentación | lettre de motivation | कवर लेटर |
| search (a saved one) | пошук | Suche | búsqueda | recherche | खोज |
| fit (the score) | відповідність | Passung | compatibilidad | adéquation | फ़िट |
| match (a job that fits) | збіг | Treffer | coincidencia | correspondance | मैच |
| alert | сповіщення | Benachrichtigung | alerta | alerte | अलर्ट |
| digest | дайджест | Zusammenfassung | resumen | récapitulatif | सारांश |
| source | джерело | Quelle | fuente | source | स्रोत |
| company | компанія | Unternehmen | empresa | entreprise | कंपनी |
| watchlist | список стеження | Beobachtungsliste | lista de seguimiento | liste de suivi | वॉचलिस्ट |
| to mute (a company) | приховати | stummschalten | silenciar | masquer | म्यूट करना |
| run (of a job) | запуск | Durchlauf | ejecución | exécution | रन |
| to fetch (jobs) | зібрати | abrufen | obtener | récupérer | लाना |
| to tailor (a resume) | адаптувати | anpassen | adaptar | adapter | अनुकूल बनाना |
| to compare | порівняти | vergleichen | comparar | comparer | तुलना करना |
| keyword | ключове слово | Schlüsselwort | palabra clave | mot-clé | कीवर्ड |
| must-have | обов'язкове | Muss-Kriterium | imprescindible | indispensable | अनिवार्य |
| nice-to-have | бажане | wünschenswert | deseable | souhaité | वांछनीय |
| suggestion | пропозиція | Vorschlag | sugerencia | suggestion | सुझाव |
| screening | скринінг | Screening | preselección | présélection | स्क्रीनिंग |
| applicant | кандидат | Bewerbende | candidato | candidat | आवेदक |
| criterion | критерій | Kriterium | criterio | critère | मानदंड |
| AI engine | рушій ШІ | KI-Engine | motor de IA | moteur d'IA | AI इंजन |
| model | модель | Modell | modelo | modèle | मॉडल |
| settings | налаштування | Einstellungen | configuración | paramètres | सेटिंग्स |
| schedule | розклад | Zeitplan | horario | horaires | शेड्यूल |
| pipeline (the fetching) | збір вакансій | Abruf | recopilación | collecte | संग्रह |
| Fetch now | Зібрати зараз | Jetzt abrufen | Obtener ahora | Récupérer maintenant | अभी लाएँ |
| gate (a requirement that must hold) | обов'язкова умова | Muss-Bedingung | requisito excluyente | condition éliminatoire | अनिवार्य शर्त |
| fit threshold | поріг відповідності | Passungsschwelle | umbral de compatibilidad | seuil d'adéquation | फ़िट सीमा |
| to score / scored / unscored | оцінити / оцінено / без оцінки | bewerten / bewertet / unbewertet | puntuar / puntuada / sin puntuar | noter / notée / non notée | स्कोर करना / स्कोर किया गया / बिना स्कोर |
| dismissed | відхилено | verworfen | descartada | écartée | खारिज |
| stage (a board column) | етап | Phase | etapa | étape | चरण |
| comparison (resume with a posting) | порівняння | Vergleich | comparación | comparaison | तुलना |
| search funnel | воронка пошуку | Suchtrichter | embudo de búsqueda | entonnoir de recherche | खोज फ़नल |
| remote / hybrid / on-site | віддалено / гібридно / в офісі | Remote / Hybrid / vor Ort | remoto / híbrido / presencial | télétravail / hybride / sur site | रिमोट / हाइब्रिड / ऑन-साइट |

The menu:

| English | Ukrainian | German | Spanish | French | Hindi |
| --- | --- | --- | --- | --- | --- |
| Overview | Огляд | Übersicht | Vista general | Vue d'ensemble | ओवरव्यू |
| Jobs | Вакансії | Stellen | Ofertas | Offres | नौकरियाँ |
| Applications | Заявки | Bewerbungen | Solicitudes | Candidatures | आवेदन |
| Resumes | Резюме | Lebensläufe | Currículums | CV | रेज़्यूमे |
| Tailor resume | Адаптувати резюме | Lebenslauf anpassen | Adaptar currículum | Adapter le CV | रेज़्यूमे अनुकूल बनाएँ |
| Cover letter | Супровідний лист | Anschreiben | Carta de presentación | Lettre de motivation | कवर लेटर |
| Companies | Компанії | Unternehmen | Empresas | Entreprises | कंपनियाँ |
| Discovery | Знахідки | Entdeckungen | Descubrimiento | Découverte | डिस्कवरी |
| Runs | Запуски | Durchläufe | Ejecuciones | Exécutions | रन |
| Screening | Скринінг | Screening | Preselección | Présélection | स्क्रीनिंग |
| Settings | Налаштування | Einstellungen | Configuración | Paramètres | सेटिंग्स |

A job's status:

| English | Ukrainian | German | Spanish | French | Hindi |
| --- | --- | --- | --- | --- | --- |
| New | Нова | Neu | Nueva | Nouvelle | नया |
| Alerted | Сповіщено | Gemeldet | Avisada | Signalée | अलर्ट भेजा गया |
| Applied | Подано | Beworben | Solicitada | Candidature envoyée | आवेदन किया |
| Saved | Збережено | Gespeichert | Guardada | Enregistrée | सहेजा गया |
| Dismissed | Відхилено | Verworfen | Descartada | Écartée | खारिज |

## Adding a language

1. Add its row to `LOCALES` in `src/i18n/locale.ts` (its own name, the
   `Intl` tag with Latin digits, the stage) and its file to
   `src/i18n/catalog/`, imported in `src/i18n/catalog.ts`.
2. Translate every key, by this glossary. `npm test` names what is missing.
3. A script the bundled fonts do not cover needs a face of its own in
   `src/web/tailwind.css` (`unicode-range`, self-hosted, an open licence).
4. Look at every page in it: a word twice the length of the English one must
   not be cut off.
