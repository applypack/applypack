/*
 * The notice an employer owes applicants when an AI-assisted tool reads
 * their resumes (hr-screening-plan.md §6, guardrail 6): GDPR art. 13–14
 * and the AI Act's transparency duty want the applicant told, in plain
 * words, what reads the application and what does not decide. Copy-ready
 * text, kept in code so the settings page and the README say the same
 * thing. Not legal advice — a starting point to hand to whoever is.
 */

export function applicantNotice(contact = '[contact address]'): string {
  return [
    'How we read your application',
    '',
    'We use a software tool with an AI component to read applications against the requirements of this position. It compares the text of your resume with the skills, experience and conditions the posting asks for, and lists what it found, with quotes from your resume, for a person on our team.',
    '',
    'No decision is made automatically. The tool orders applications by what it found; a person reads them and decides whom to talk to. It does not see your name, contact details, photo, date of birth, age, family situation, gender, citizenship or address — those are removed before the text is analysed.',
    '',
    `You may ask how your application was read, request that it be reviewed by a person without the tool, or object to this processing, by writing to ${contact}. Your application and its analysis are deleted after the hiring round closes.`,
  ].join('\n');
}

/** What the person turning the mode on is agreeing to carry — the settings tab says it once, in full. */
export const LEGAL_NOTE = [
  'Screening other people’s resumes with an AI tool is regulated in a way the rest of ApplyPack is not. Under the EU AI Act (Annex III, 4(a)) a system that filters job applications is high-risk, and the open-source exemption does not cover high-risk use; under GDPR art. 22 nobody may be subject to a hiring decision made solely by automated means, and art. 13–14 require applicants to be told. NYC Local Law 144, Colorado SB 24-205 and Illinois HB 3773 add audit and notice duties in the US.',
  'This mode is built to be the tool, not the decision: it ranks, quotes and asks; a person decides, and every score can be read off a table. Two things are yours: tell applicants (the notice below), and run it on an engine you have a data-processing agreement with or on a local model — a personal-subscription CLI is not that.',
].join(' ');
