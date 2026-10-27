<img src="assets/icon.svg" width="64" height="64" alt="">

# Stämpelklocka

En enkel stämpelklocka för iPhone och dator. Tryck **IN** när du kommer och **UT** när du går. Appen räknar ut arbetad tid per dag, vecka och månad och drar automatiskt av raster.

## Funktioner

- En stor In/Ut-knapp. Appen vet själv om du är in- eller utstämplad.
- Raster dras av automatiskt: **frukost 09:00–09:15** och **lunch 12:00–12:30**. Bara den del av rasten du faktiskt var instämplad dras av. Kommer du 10:00 dras ingen frukost, och går du 12:10 dras bara 10 minuter lunch. Rasterna kan ändras under Inställningar.
- Historik per månad och vecka med brutto, avdragna raster och netto.
- Glömt att stämpla? Lägg till eller ändra stämplingar i efterhand. Ett pass som saknar Ut markeras med ⚠️, och du trycker på `??` för att fylla i tiden.
- Exportera en månad som CSV (öppnas direkt i Excel).
- Fungerar offline och kan läggas på hemskärmen som en app.
- Valfri synk mellan telefon och dator via en gratis Supabase-databas.
- Dra ner på skärmen (på telefonen) för att synka direkt.

## 1. Publicera appen (gratis via GitHub Pages)

iPhone kräver https för att appen ska kunna installeras. Enklast är GitHub Pages:

1. Skapa ett nytt repo på GitHub, t.ex. `stampelklocka`.
2. Pusha den här mappen dit:
   ```
   git remote add origin https://github.com/<ditt-namn>/stampelklocka.git
   git push -u origin master
   ```
3. Gå till repot på GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: master / (root) → Save**.
4. Efter en minut finns appen på `https://<ditt-namn>.github.io/stampelklocka/`.

## 2. Installera på iPhone

1. Öppna adressen i **Safari**.
2. Tryck på **Dela** (fyrkanten med pilen) → **Lägg till på hemskärmen**.
3. Nu finns "Stämpla" som en app-ikon och öppnas i helskärm.

## 2b. Installera på datorn

Öppna adressen i **Edge** eller **Chrome**:

- **Edge:** klicka på **⋯** uppe till höger → **Appar** → **Installera den här webbplatsen som en app** → **Installera**.
- **Chrome:** klicka på installationsikonen längst till höger i adressfältet (en skärm med en pil), eller **⋮** → **Spara och dela** / **Casta, spara och dela** → **Installera sidan som app**.

Appen får då samma stämpelklocka-ikon som på telefonen, öppnas i ett eget fönster och finns i Start-menyn. Högerklicka på ikonen i aktivitetsfältet och välj **Fäst i aktivitetsfältet** så når du den med ett klick.

## 3. Synk mellan telefon och dator (valfritt)

Utan synk sparas stämplingarna bara i den webbläsare där du gjorde dem. Vill du se samma data på telefonen och datorn gör du så här:

1. Skapa ett gratis konto på [supabase.com](https://supabase.com) och skapa ett nytt projekt.
2. Öppna **SQL Editor → New query**, klistra in innehållet i [`supabase.sql`](supabase.sql) och tryck **Run**.
3. Öppna **Project Settings → API** och kopiera **Project URL** och **Publishable key** (börjar med `sb_publishable_`).
4. Gå till **Inställningar** i appen på telefonen:
   - Fyll i URL och publishable key.
   - Tryck **Skapa** för att få en synknyckel.
   - Tryck **Spara & synka**.
5. Gör samma sak på datorn, men klistra in **samma synknyckel** i stället för att skapa en ny. Skicka den till dig själv, t.ex. via Anteckningar eller AirDrop.

Synknyckeln fungerar som ett lösenord. Den som har den kan läsa och ändra dina stämplingar, så dela den inte med någon. Publishable key är däremot ofarlig att ha i appen eftersom tabellen är låst och bara kan nås via synknyckeln.

Synken sker automatiskt när du stämplar, när du öppnar appen, när du får nätverk igen och varje minut medan appen är öppen. Stämplar du offline synkas det senare. Rastinställningarna synkas inte, så ändrar du dem behöver du göra det på båda enheterna.

## Utveckling

Appen är ren HTML/CSS/JavaScript och behöver inget byggsteg.

```
npx http-server -p 5173 -c-1   # kör lokalt på http://localhost:5173
npm test                       # testar tidsberäkning och synk
```

| Fil | Innehåll |
| --- | --- |
| `calc.js` | Tidsberäkning: parar In/Ut till pass och drar av raster |
| `app.js` | Gränssnitt och lagring (localStorage) |
| `sync.js` | Synk mot Supabase |
| `supabase.sql` | Databastabell och funktioner för synk |
| `sw.js` | Service worker för offlinestöd |
