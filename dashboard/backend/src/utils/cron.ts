export function calculateNextRun(cronSchedule: string): Date {
  const now = new Date();

  // Basic implementation: always adds 24 hours if simple format not matched
  // In a real app, use 'cron-parser' package

  // Simple check for "minute hour * * *" format which is what the frontend likely sends
  const parts = cronSchedule.split(' ');
  if (parts.length === 5) {
    const [minute, hour] = parts;
    const next = new Date();

    // Set target time
    next.setHours(parseInt(hour, 10) || 0);
    next.setMinutes(parseInt(minute, 10) || 0);
    next.setSeconds(0);
    next.setMilliseconds(0);

    // If target time is in past, move to tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  // Fallback: next day at same time
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
