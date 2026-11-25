-- Ambassadeur (lot 15, ADR 0019) : le ticket peut être déclaré par scan de son QR code.
-- Contenu brut du QR conservé pour la vérification future auprès de Splash360 (format encore
-- inconnu, questions-en-attente n° 17) ; ticket_ref en est déduit côté serveur.
alter table public.ambassador_entries
  add column ticket_qr text check (ticket_qr is null or length(ticket_qr) between 1 and 512);

comment on column public.ambassador_entries.ticket_qr is
  'Contenu brut du QR code du ticket scanné (null si le numéro a été saisi).';
