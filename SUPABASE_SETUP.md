# Supabase Setup For OPE Assessor

This is the one-time fix that makes the normal 6-digit quiz ID work across devices.

## What Supabase does here

Supabase is the shared online database.

Without it:
- your phone saves the quiz only on your phone
- student phones do not see that quiz
- the 6-digit ID fails on other devices

With it:
- the quiz is saved online
- every phone opens the same quiz from the same database
- the 6-digit ID works across devices

## Step 1: Create a Supabase project

1. Open `https://database.new`
2. Sign in or create a Supabase account
3. Create a new project
4. Choose any project name, for example `ope-assessor`
5. Choose a database password and keep it safe
6. Wait for the project to finish creating

## Step 2: Get the two values you need

Inside your Supabase project dashboard:

1. Open the project's `Connect` dialog or `Settings > API Keys`
2. Copy your `Project URL`
3. Copy your server-side key:
   - use `sb_secret_...` if Supabase shows the new secret key format
   - or use the legacy `service_role` key if that is what you see

Important:
- never put this server-side key in browser code
- only put it in Vercel environment variables

## Step 3: Create this app's tables in Supabase

1. In Supabase, open `SQL Editor`
2. Open [supabase/schema.sql](/C:/Users/HP/Documents/OPEASSESSOR/supabase/schema.sql)
3. Copy everything in that file
4. Paste it into the SQL Editor
5. Run it

## Step 4: Add the values to Vercel

In your Vercel project:

1. Open `Settings`
2. Open `Environment Variables`
3. Add these variables:

`STORAGE_BACKEND` = `supabase`

`SUPABASE_URL` = your Supabase Project URL

`SUPABASE_SERVICE_ROLE_KEY` = your Supabase secret key or legacy service_role key

Optional:

`SUPABASE_TABLE_PREFIX` = `ope_`

## Step 5: Redeploy

1. Redeploy the Vercel project
2. After deploy, open:

`https://YOUR-DOMAIN/api/health`

It should show that the storage backend is `supabase`.

## Step 6: Test the fix

1. Open the teacher app
2. Open a quiz and save it again once
3. Send the normal 6-digit quiz ID to a student
4. Open the app on another phone
5. Enter that 6-digit ID

If Supabase is connected correctly, it should now work across devices.

## If it still fails

Check these first:

- `STORAGE_BACKEND` must be exactly `supabase`
- `SUPABASE_URL` must be the real project URL
- `SUPABASE_SERVICE_ROLE_KEY` must be the server-side key, not the public key
- `supabase/schema.sql` must have been run successfully
- the app must be redeployed after adding the environment variables
- old phone/PWA caches may need refresh

## Quick meaning of the 6-digit ID

The 6-digit number is only a lookup key.

It is not the quiz itself.

So the app needs one shared online database behind it, and Supabase is that database.
