-- OPE Assessor shared-state schema for Supabase
-- Run this in the Supabase SQL editor before switching STORAGE_BACKEND to supabase.

create table if not exists public.ope_quizzes (
  quiz_id text primary key,
  teacher_id text,
  title text,
  created_at timestamptz,
  updated_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists ope_quizzes_teacher_id_idx on public.ope_quizzes (teacher_id);
create index if not exists ope_quizzes_updated_at_idx on public.ope_quizzes (updated_at desc);

create table if not exists public.ope_teachers (
  teacher_id text primary key,
  email text,
  role text,
  created_at timestamptz,
  updated_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists ope_teachers_email_idx on public.ope_teachers (email);
create index if not exists ope_teachers_updated_at_idx on public.ope_teachers (updated_at desc);

create table if not exists public.ope_students (
  teacher_id text not null,
  student_key text not null,
  name text,
  email text,
  registration_no text,
  uploaded_at timestamptz,
  updated_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  primary key (teacher_id, student_key)
);

create index if not exists ope_students_teacher_id_idx on public.ope_students (teacher_id);
create index if not exists ope_students_email_idx on public.ope_students (email);

create table if not exists public.ope_submissions (
  submission_id text primary key,
  quiz_id text not null,
  student_email text,
  submitted_at timestamptz,
  updated_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists ope_submissions_quiz_id_idx on public.ope_submissions (quiz_id);
create index if not exists ope_submissions_student_email_idx on public.ope_submissions (student_email);
create index if not exists ope_submissions_submitted_at_idx on public.ope_submissions (submitted_at desc);
how can i redeploy? that is where i am stuck
