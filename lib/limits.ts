export const limits = {
  registrations_per_ip_minute: 300,
  registrations_per_ip_day: 10000,
  notes_per_actor_minute: 60,
  notes_per_actor_hour: 600,
  reports_per_actor_minute: 120,
  reports_per_actor_hour: 1200,
  read_cache_seconds: 5,
  change_poll_seconds: 10,
} as const;
