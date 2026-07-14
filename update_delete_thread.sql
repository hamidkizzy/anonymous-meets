-- ============================================================
-- Run this in Supabase's SQL Editor. Lets either participant
-- delete an entire chat thread (all its messages cascade-delete
-- automatically since chat_messages references it ON DELETE CASCADE).
-- ============================================================
create policy "Participant can delete thread" on chat_threads
  for delete to authenticated
  using (creator_id = auth.uid() or guest_id = auth.uid());

grant delete on public.chat_threads to authenticated;
