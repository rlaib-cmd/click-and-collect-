-- Décision du propriétaire (26/11) : 1 € = 1 point par défaut (au lieu de 10), plus simple.
-- Les enseignes qui ont déjà enregistré leur propre règle la gardent.
alter table public.loyalty_program_settings alter column points_per_euro set default 1;
