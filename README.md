# Sharked

Claim real-world map territory by completing swims.

## Running the app on your phone (Windows)

One-time setup on your PC:

1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Install **Git** from https://git-scm.com/download/win (accept the defaults).
3. Open **Command Prompt** and download the code:
   ```
   git clone https://github.com/mardonben/swim-territory.git
   cd swim-territory
   npm install
   ```
4. Add your Mapbox key so the map can load. Log in at https://account.mapbox.com, copy the **Default public token** (it starts with `pk.`), then in Command Prompt inside the `swim-territory` folder run this, pasting your token in place of `pk.YOUR_TOKEN`:
   ```
   echo EXPO_PUBLIC_MAPBOX_TOKEN=pk.YOUR_TOKEN> .env.local
   ```
   This file stays on your PC only and is never uploaded to GitHub. Public tokens are designed to live inside apps, but don't paste it into chats.

Each time you want to try the latest version:

1. In Command Prompt, inside the `swim-territory` folder:
   ```
   git pull
   npm install
   npx expo start
   ```
2. A QR code appears. Open **Expo Go** on your Android phone and scan it.
3. Your phone and PC need to be on the same Wi-Fi. If it won't connect, stop it with Ctrl+C and run `npx expo start --tunnel` instead.

## Using the map

- **Move and zoom** with two fingers. One finger never moves the map.
- **Draw** a loop with one finger and lift it. The app tidies it into the shape you meant (draw a rectangle, get a rectangle) with rounded corners. Roads don't matter: it's all about territory.
- **📍** (bottom left of the map) jumps back to where you are.
- **🏊 Pick a swim** lets you choose 25 m to 10 km. The app draws a circle from the middle of the map, sized so its boundary matches that swim.
- **🗑️ Clear** starts over.

Shapes never go out to sea: they're trimmed to the coastline and cut straight across river mouths. The boundary length sets the swim. The number shown is the swim that claims the shape: every 1 km you swim claims 4 km of outline.

## Locking in a challenge (needs Supabase, one-time setup)

Once you have a shape, tap **🔒 Lock in this challenge**. It's saved online as your pending challenge and shows on the map as an orange dashed area, with a banner saying how far to swim. You can have one pending challenge at a time; tap **Cancel** on the banner to drop it.

One-time setup:

1. In the Supabase dashboard, open your project, go to **SQL Editor**, paste the whole of `supabase/schema.sql` and press **Run**.
2. Go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Save.
3. Find your **Project URL** and **publishable key** (Project Settings → API Keys, or the **Connect** button at the top). Add them to `.env.local` (note the double `>>`, which adds to the file instead of replacing it):
   ```
   echo EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co>> .env.local
   echo EXPO_PUBLIC_SUPABASE_KEY=YOUR_PUBLISHABLE_KEY>> .env.local
   ```
4. Restart with `npx expo start`.

## Build plan

1. Blank app on the phone ✅
2. Map where you draw or pick a territory, showing the swim to claim it ✅
3. Save the shape as a pending challenge (Supabase) ✅
4. Colour the territory once a qualifying swim is done
5. Strava connection for real watch-recorded swims
