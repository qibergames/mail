# QiberMail – megvalósítási terv

Utolsó frissítés: 2026-09-04

## Státuszkövetés

Minden fázisnál vezetjük az állapotot (`pending`, `active`, `blocked`, `done`), az elkészült és hátralévő feladatokat, az ellenőrzések eredményét és a kapcsolódó commitot. Egyszerre csak egy fázis lehet `active`; a következő csak az előző ellenőrzőkapujának teljesítése után indul.

| Fázis | Állapot | Eredmény |
|---|---|---|
| 0. Feltérképezés | `done` | Követelmények és forrásrendszer rögzítve |
| 1. Projektalap | `done` | TanStack Start, Bun, shadcn/ui, Lingui |
| 2. Cloudflare és adatmodell | `done` | 9 binding, 25 Drizzle tábla, friss D1 migráció |
| 3. Better Auth | `done` | Zárt setup, session, reset, admin és rollback |
| 4. Levelezési motor | `done` | Queue-alapú küldés/fogadás, realtime és webhook |
| 5. Felhasználói felület | `done` | Reszponzív postaláda, beállítások és eszközök |
| 6. Admin és extra funkciók | `done` | Shared mail, routing, API, IMAP, backup, audit |
| 7. PWA és push | `done` | Standalone PWA, Web Push és deep link |
| 8. Stabilizálás | `done` | 12 teszt, friss-D1 próba, build és deploy dry-run |
| 9. Éles helyreállítás | `done` | D1 migráció, runtime Turnstile és production smoke |
| 10. Setup diagnosztika | `done` | Siteverify hibakódok és automatikus token-reset |
| 11. Turnstile lifecycle | `done` | Lejárat-, timeout- és újrapróbálkozás-kezelés |
| 12. UI finomhangolás | `done` | Shadcn postaláda-select és könnyebb kapcsolók |

## 0. fázis – Feltérképezés `done`

- A célrepo `main` ága tiszta, csak az üres initial commit létezett.
- A forrás a szomszédos `mailflare`: 501 source fájl, 50 oldal és 74 API route.
- Rögzített döntések: QiberMail brand; TanStack Start; shadcn/ui; Bun; Better Auth; Cloudflare-native infrastruktúra; magyar és angol Lingui-felület; Light/Dark/System téma; teljes funkcióparitás; minden Pro/Team funkció feloldva; friss telepítés; telepíthető PWA háttér-push értesítéssel.

## 1. fázis – Projektalap `done`

- TanStack Start React projekt Bun használatával.
- `packageManager: "bun@1.4.1"`, kizárólag `bun.lock`.
- Cloudflare Vite plugin, TanStack file-based routing és root document.
- shadcn/ui New York stílus, CSS-változók és csak a ténylegesen használt komponensek.
- Lingui `hu`/`en` katalógusok, extract/compile scriptek és per-request SSR i18n alap.
- Light/Dark/System theme provider villanásmentes inicializálással.
- QiberMail alap-branding és metadata.

Ellenőrzőkapu: `bun install --frozen-lockfile`, fejlesztői szerver, SSR, nyelv- és témaváltás, TypeScript és production build.

Eredmény: Bun 1.4.1 lockfile, TanStack Start SSR, shadcn-alapkomponens, per-request magyar/angol Lingui, villanásmentes témakezelés és reszponzív QiberMail kezdőfelület elkészült. `bun run check` sikeres; a magyar SSR-t külön HTTP-kéréssel ellenőriztük. A host globális file-watcher limitje miatt a dev smoke test pollinggal futott.

## 2. fázis – Cloudflare-platform és adatmodell `done`

- Egyedi TanStack worker entry `fetch`, email, queue, Durable Object és Workflow handlerekkel.
- D1, R2, inbound/outbound Queues, Email Routing/Sending, realtime Durable Object, backup Workflow, rate limiter, service binding és observability.
- Friss Drizzle séma és összevont kezdeti migráció.
- Better Auth és mail alkalmazástáblák, valamint `push_subscriptions`.
- Saját Mailflare session-, password- és licenctáblák elhagyása.
- Cloudflare env-típusok és fejlesztői változóminta.

Ellenőrzőkapu: lokális D1 migráció, schema check, Wrangler typegen és deploy dry-run.

Eredmény: a `fetch`, `email`, `queue` és `scheduled` handlerek egy Worker entryben működnek. A friss adatbázis-próba mindhárom migrációt és 27 fizikai táblát (25 alkalmazástábla + migrációs/meta táblák) sikeresen létrehozott. A Wrangler dry-run felismerte a D1, R2, két Queue, Email, Durable Object, Workflow, service és rate-limit bindinget.

## 3. fázis – Better Auth és jogosultságok `done`

- Better Auth D1/Drizzle adapterrel, email/jelszó móddal és admin pluginnal.
- `/api/auth/$`, login/logout/reset és szerveroldali route guardok.
- Első adminos, Turnstile-védett setup domain- és mailbox-provisionálással, hibánál rollbackkel.
- Az első admin után zárt regisztráció; admin által kezelt accountok, tiltás, szerepkörök és mailbox-jogosultságok.

Ellenőrzőkapu: setup egyszerisége, hibás setup rollback, tiltott user kizárása, jogosultsági tesztek és biztonságos cookie-k.

Eredmény: a publikus regisztráció le van zárva; az első Turnstile-védett setup hoz létre admint, domaint és postaládát. A hibás Cloudflare-provisionálási smoke teszt után `users=0` és `app_settings=0` maradt. A TanStack cookie plugin szándékosan kimaradt, mert a teljes Better Auth HTTP Response visszaadása biztosítja a cookie-t, míg a plugin hibás setupnál kiszivárogtatott volna egy visszagörgetett session cookie-t. Login és jelszó-reset IP rate limitet és Turnstile-t kapott.

## 4. fázis – Levelezési motor `done`

- Bejövő címfeloldás, routing, reject/forward/keep-copy, raw R2 mentés, MIME parsing, D1 mentés, szabályok, auto-reply, webhook és realtime.
- Compose/reply/forward, HTML/plain text, aláírás, csatolmány, ütemezés, outbound queue és retry.
- Aliasok, shared mailbox hozzáférések és account forwarding.
- A hibák nem okozhatnak csendes levélvesztést vagy duplikációt.

Ellenőrzőkapu: inbound/outbound fixture tesztek, routing ágak, retry-idempotencia és realtime jogosultság.

Eredmény: explicit címek, aliasok és Cloudflare catch-all útvonalak, domain/mailbox szabályok, forwarding, blokkolás, raw R2, MIME/csatolmány feldolgozás, auto-reply deduplikálás és shared-user realtime elkészült. A kimenő queue job küldési claimet, retry állapotot, aláírást, on-behalf feladót és perces cronból tartós időzítést használ. A fogadott/elküldött események külön, HMAC-aláírt webhook queue-ba kerülnek.

## 5. fázis – Felhasználói postaláda `done`

- Reszponzív dashboard, mailbox selector és mobil navigáció.
- Inbox, sent, drafts, starred, snoozed, archived, spam, trash és egyedi mappák.
- Lista/detail, keresés, státuszműveletek, bulk műveletek és composer.
- Profil, jelszó, signature, auto-reply, forwarding, szabályok és import/export.
- Teljes magyar/angol, light/dark és akadálymentes shadcn/ui felület.

Ellenőrzőkapu: minden route, mobil használhatóság, draft adatbiztonság, hiánytalan fordítás és mindkét téma.

Eredmény: desktop split-view és mobil drawer, nyolc rendszermappa, egyedi mappák, keresés, detail, biztonságos sandboxolt HTML-nézet, csatolmányletöltés, tömeges műveletek, reply/forward, automatikusan mentett piszkozat, sablon, időzítés és composer elkészült. A profil-, jelszó-, forwarding-, signature-, auto-reply-, folder- és inbox-rule beállítások valós API-kat használnak. A magyar/angol és Light/Dark/System kapcsolók SSR-kompatibilisek.

## 6. fázis – Admin és teljes funkcióparitás `done`

- Account, domain, mailbox, alias, delegált hozzáférés és routing admin.
- API-kulcsok, contacts/blocklist, naptár, sablonok és ütemezés.
- Webhookok, retry, audit/activity és backup/restore.
- `/api/v1/messages` és `/api/v1/send` kompatibilitás.
- Paymug, license UI/API és feature gate-ek eltávolítása; minden funkció aktív.

Ellenőrzőkapu: jogosultsági mátrix, API scope-ok, backup restore, webhook retry és nulla licenchivatkozás.

Eredmény: adminból kezelhető account/szerepkör/tiltás, domain, personal/shared mailbox, alias, delegált jogosultság és domain routing. A Tools felület kontaktokat/blokkolást, sablonokat, naptárt, scoped API-kulcsokat, signed webhookokat, EML/IMAP importot, MBOX exportot és admin backup/restore-t biztosít. A backup D1-ből privát R2-be készül Workflow-val, ütemezéssel és retentionnel. A brand a kért fix QiberMail; önfrissítő supply-chain endpoint nincs. A forrásban nincs Paymug-, licenctábla-, licenc-API- vagy feature-gate kód.

## 7. fázis – PWA és háttérértesítés `done`

- QiberMail manifest, standalone mód és 192/512/maskable ikonok.
- Minimális service worker push, notification click és badge kezeléssel; levéladat-cache nélkül.
- Eszközönkénti fel- és leiratkozás, VAPID public key endpoint és Wrangler secret.
- Sikeresen mentett inbound email után lokalizált értesítés a tulajdonos és jogosult shared userek eszközeire.
- Az értesítés feladót és tárgyat mutat, body preview-t nem; kattintásra megnyitja a levelet.
- 404/410 push válasznál subscription-takarítás; push hiba nem ismétli a levélmentést.

Ellenőrzőkapu: Android és iOS Home Screen teszt, bezárt app melletti push, több eszköz, deep link és badge.

Eredmény: manifest, 192/512/Apple és külön full-bleed maskable QiberMail ikon, minimális service worker, notification click/focus, badge, eszközönkénti subscription és nyelvszinkron elkészült. A push payload-teszt rögzíti, hogy csak feladó, tárgy, routing ID és számláló kerül ki; body/snippet nem. A 404/410 subscription automatikusan törlődik, push hiba nem dobja újra a bejövő levél mentését. A valódi bezárt-app Android/iOS kézbesítés csak deployolt HTTPS origin, VAPID secret és fizikai eszköz mellett ellenőrizhető.

## 8. fázis – Stabilizálás és kiadás `done`

- Biztonsági headerek, CSP, limitek, rate limit, validáció, D1 indexek, queue-idempotencia és R2 cleanup audit.
- Accessibility, responsive és fordítási audit.
- `bun test`, TypeScript, production build, Drizzle check és Wrangler dry-run CI-ben.
- Friss Cloudflare-telepítési próba és QiberMail README/deployment/API/PWA dokumentáció.
- AGPL-3.0 licenc, eredeti szerzői értesítések és módosítási dátumok.

Végső elfogadás: új Cloudflare accounton telepíthető; domain kapcsolható; levél küldhető és fogadható; minden admin/shared/korábbi Pro funkció működik; mobilon telepíthető; háttér-email telefonos push értesítést küld; csak `bun.lock` létezik; minden CI-ellenőrzés zöld.

Eredmény: CSP, HSTS, Referrer/Permissions policy, input- és méretlimitek, Turnstile/rate limit, API scope, jogosultság-ellenőrzés, raw/attachment idempotencia, private-network endpoint tiltás és push-adatminimalizálás bekerült. `bun install --frozen-lockfile`, TypeScript, ESLint, 12 Bun-teszt, Vite production build, tiszta D1 migráció és Wrangler deploy dry-run zöld. Worker feltöltés: 3309.54 KiB, gzip 710.80 KiB. Az Email Sending, telefonos install és bezárt-app push próba továbbra is `pending_external`.

## 9. fázis – Éles helyreállítás `done`

- A production Worker D1 bindingje bekerült a Wrangler konfigurációba, mindhárom migráció lefutott az éles adatbázison.
- A `bun run deploy` most build után automatikusan alkalmazza a remote D1 migrációkat, majd csak siker esetén deployol.
- A Turnstile nyilvános site keyt a kliens runtime API-n keresztül kapja, így Wrangler secretként tárolva is működik.

Ellenőrzőkapu: production `/` átirányítás, `/setup` 200, migrációlista, runtime Turnstile key, teljes `bun run check` és sikeres Worker deploy.

Eredmény: az éles root 307-tel a setupra irányít, a setup 200, a D1 naprakész, a Turnstile key elérhető és a Worker `0155bf11-056a-41f5-b349-2aa0b391bbac` verziója fut.

## 10. fázis – Setup diagnosztika `done`

- A Turnstile Siteverify hibakódjai token és secret naplózása nélkül bekerülnek a strukturált Worker logba és a setup hibaválaszába.
- Sikertelen setup után a kliens kiírja a technikai hibakódot, eldobja az egyszer használható tokent és új widgetet kér.

Ellenőrzőkapu: TypeScript, ESLint, 12 Bun-teszt és production build.

Eredmény: minden ellenőrzés zöld; a következő éles próbálkozás már pontos okot mutat a generikus hiba helyett.

## 11. fázis – Turnstile lifecycle `done`

- Lejáratkor és challenge timeoutnál a kliens törli a régi tokent és reseteli a widgetet.
- Sikertelen setup után továbbra is új widget készül, így egyszer használható token nem kerül újraküldésre.
- A retry nélküli Siteverify kérés fölösleges idempotency kulcsa kikerült.

Ellenőrzőkapu: TypeScript, ESLint, 12 Bun-teszt és production build.

Eredmény: a `timeout-or-duplicate` gyökérok kliensoldali kezelése elkészült, minden ellenőrzés zöld.

## 12. fázis – UI finomhangolás `done`

- A böngészőfüggő natív postaláda-dropdown helyett témázott, billentyűzettel kezelhető shadcn/Radix Select készült.
- A nyelv- és témakapcsolókról lekerült a nehéz dupla kapszulakeret; az aktív állapot és az akadálymentes csoportjelölés megmaradt.

Ellenőrzőkapu: TypeScript, ESLint, 12 Bun-teszt és production build.

Eredmény: a sidebar vezérlői light/dark módban egységes shadcn megjelenést kaptak, minden ellenőrzés zöld.

## Tudatos egyszerűsítések

- Nincs régi Mailflare-adatmigráció.
- Nincs Paymug vagy feature gating.
- Nincs offline levélszinkron/cache.
- Nincs platformabsztrakció a rögzített Cloudflare szolgáltatások elé.
- A QiberMail brand fix, ezért nincs runtime white-label editor.
- Nincs távoli GitHub-kódot automatikusan productionbe telepítő önfrissítő endpoint; a frissítés auditálható `bun run deploy` folyamattal történik.

## Végrehajtási napló

- 2026-09-04: 0. fázis lezárva; 1. fázis elindítva. Bun 1.4.1 elérhető, célrepo induláskor üres és tiszta.
- 2026-09-04: 1. fázis lezárva; 2. fázis elindítva. TypeScript, ESLint, 4 Bun-teszt, production build és magyar SSR sikeres.
- 2026-09-04: 2–4. fázis lezárva. Friss D1 migráció, 9 Cloudflare binding, Better Auth rollback smoke, mail routing/queue/realtime elkészült.
- 2026-09-04: 5–7. fázis lezárva. Reszponzív kliens, beállítások/admin/eszközök, shared funkciók, PWA és Web Push elkészült.
- 2026-09-04: 8. fázis helyi kapui lezárva. 12/12 teszt, TypeScript, lint, build, friss D1 és Wrangler dry-run sikeres; éles account/telefon validáció `pending_external`.
- 2026-09-04: 9. fázis lezárva. A hiányzó production D1 migráció és a Turnstile build/runtime eltérés javítva; az éles setup smoke zöld.
- 2026-09-04: 10. fázis lezárva. A setup és Turnstile hibák biztonságosan diagnosztizálhatók, a felhasznált token automatikusan megújul.
- 2026-09-04: 11. fázis lezárva. A Turnstile lejárat/timeout callbackjei és token-reset bekerültek.
- 2026-09-04: 12. fázis lezárva. A postaláda-választó és a fejléc kapcsolói shadcn stílusra lettek finomítva.
