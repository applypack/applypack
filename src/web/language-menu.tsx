/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import {
  SOURCE_LOCALE,
  currentLocale,
  isBeta,
  localeName,
  offeredLocales,
  unfinishedLocales,
  withLocale,
  type Locale,
} from '../i18n/locale';
import { t } from '../i18n/t';
import { Icon } from './icons';
import { languagePage } from './language';
import { tRich } from './rich';
import { ActionForm, Badge, Button, Disclosure, Hint, MarkIcon } from './ui';

/*
 * The language controls (ADR 0061): the switcher at the bottom of the menu
 * and on the wizard's first step, the one-time invitation, and the list on
 * Settings → General. A language is written in its own name, with a globe and
 * never a flag — a flag is a country, and a language is not.
 */

const SWITCH_ACTION = '/settings/locale';
/** Where a wording is corrected. */
const CATALOG_URL = 'https://github.com/applypack/applypack/tree/main/src/i18n/catalog';
const SETTINGS_BACK = '/settings?tab=general#language';

/** A language's own name: said in that language, and left alone by a translating browser. */
const OwnName: FC<{ locale: Locale; class?: string }> = ({ locale, class: className }) => (
  <span lang={locale} translate="no" class={className}>
    {localeName(locale)}
  </span>
);

const TRIGGER = {
  /** A row of the menu: the globe alone on the icon rail. */
  sidebar:
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-overlay hover:text-ink md:justify-center md:px-0 lg:justify-start lg:px-3',
  /** A quiet control beside a page's title. */
  inline:
    'inline-flex min-h-[30px] items-center gap-1.5 rounded-md px-2.5 py-1 text-note font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-overlay hover:text-ink',
} as const;

/**
 * The switcher: the current language behind a globe, the choice in a native
 * popover — no script, Escape or a click outside closes it. It lists what is
 * offered, plus the language in use when that one is still unfinished, and
 * draws nothing while there is nothing to choose between.
 */
export const LanguageMenu: FC<{ variant: keyof typeof TRIGGER }> = ({ variant }) => {
  const current = currentLocale();
  const offered = offeredLocales();
  const choices: Locale[] = unfinishedLocales().includes(current) ? [...offered, current] : offered;
  if (choices.length < 2) return null;
  const id = `language-${variant}`;
  const label = t('language.label');
  return (
    // One element for the row it sits in: a sibling's spacing rule would otherwise reach the popover and pin it to the top.
    <div>
      <button type="button" popovertarget={id} class={TRIGGER[variant]} title={label}>
        <Icon name="globe" size={variant === 'sidebar' ? 18 : 16} />
        <span class="sr-only">{label}: </span>
        <OwnName locale={current} class={variant === 'sidebar' ? 'truncate md:hidden lg:block' : undefined} />
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        class="m-auto w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface-raised p-4 text-left text-sm text-ink shadow-pop backdrop:bg-[rgb(13_20_33/0.25)]"
      >
        <h2 class="text-entity text-ink">{label}</h2>
        <form method="post" action={SWITCH_ACTION} class="mt-3 grid gap-1">
          <input type="hidden" name="back" value={languagePage().back} />
          {choices.map((l) => (
            <button
              type="submit"
              name="locale"
              value={l}
              aria-current={l === current ? 'true' : undefined}
              class={`flex min-h-[36px] w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors duration-150 ${
                l === current ? 'bg-surface-selected font-medium text-accent-strong' : 'text-ink hover:bg-surface-overlay'
              }`}
            >
              <OwnName locale={l} class="min-w-0 flex-1 truncate" />
              {isBeta(l) && <Badge>{t('language.beta')}</Badge>}
              {l === current && <MarkIcon kind="check" />}
            </button>
          ))}
        </form>
      </div>
    </div>
  );
};

/**
 * The one-time line for an install that never chose (language.ts): written in
 * the browser's language, with the switch and the refusal as its two answers.
 * Either answer stores a choice, so the line does not come back.
 */
export const LanguageInvite: FC = () => {
  const { invite, back } = languagePage();
  if (!invite) return null;
  // Worded here, not in a child component: hono/jsx calls a component at render, outside this language.
  const words = withLocale(invite, () => ({
    text: t('language.invite.text'),
    yes: t('language.invite.switch'),
    no: t('language.invite.keep'),
  }));
  const answer = (locale: Locale, text: string, tone: string) => (
    <form method="post" action={SWITCH_ACTION}>
      <input type="hidden" name="back" value={back} />
      <button type="submit" name="locale" value={locale} class={`cursor-pointer font-medium transition-colors duration-150 ${tone}`}>
        {text}
      </button>
    </form>
  );
  return (
    <div lang={invite} class="rounded-md bg-surface-overlay px-3 py-2.5 text-meta leading-4 text-ink-muted md:hidden lg:block">
      <p>{words.text}</p>
      <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {answer(invite, words.yes, 'text-accent-strong hover:text-accent-deep')}
        {answer(SOURCE_LOCALE, words.no, 'text-ink-muted hover:text-ink')}
      </div>
    </div>
  );
};

const LanguageRow: FC<{ locale: Locale; current: boolean }> = ({ locale, current }) => (
  <li class="flex min-h-[36px] flex-wrap items-center gap-2 py-2 text-sm first:pt-0 last:pb-0">
    <OwnName locale={locale} class="font-medium text-ink" />
    {isBeta(locale) && <Badge>{t('language.beta')}</Badge>}
    {current ? (
      <Badge tone="ok">{t('language.current')}</Badge>
    ) : (
      <ActionForm action={SWITCH_ACTION} hidden={{ locale, back: SETTINGS_BACK }} class="ml-auto">
        <Button variant="secondary" size="sm">
          {t('language.use')}
          <span class="sr-only">
            : <OwnName locale={locale} />
          </span>
        </Button>
      </ActionForm>
    )}
  </li>
);

const CatalogLink: FC<{ words: Child[] }> = ({ words }) => (
  <a href={CATALOG_URL} target="_blank" rel="noopener" class="text-accent-strong hover:underline">
    {words}
  </a>
);

/** Settings → General → Language: what is offered, and — folded — what is still being translated. */
export const LanguageSettings: FC = () => {
  const current = currentLocale();
  const offered = offeredLocales();
  const unfinished = unfinishedLocales();
  return (
    <>
      <ul class="divide-y divide-line">
        {offered.map((l) => (
          <LanguageRow locale={l} current={l === current} />
        ))}
      </ul>
      {offered.some(isBeta) && <Hint>{tRich('settings.language.betaNote', {}, { link: (words) => <CatalogLink words={words} /> })}</Hint>}
      {unfinished.length > 0 && (
        <Disclosure summary={t('settings.language.unfinished')} open={unfinished.includes(current)}>
          <div class="mt-2 space-y-3">
            <Hint>{tRich('settings.language.unfinishedNote', {}, { link: (words) => <CatalogLink words={words} /> })}</Hint>
            <ul class="divide-y divide-line">
              {unfinished.map((l) => (
                <LanguageRow locale={l} current={l === current} />
              ))}
            </ul>
          </div>
        </Disclosure>
      )}
    </>
  );
};
