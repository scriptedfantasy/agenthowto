import { activity } from '@/lib/activity';
import { ApiError } from '@/lib/validation';
import { ActivityChart } from './activity-chart';

export async function ActivitySection({ month }: { month: string | null }) {
  let data;
  let error = '';
  try {
    data = await activity(month);
  } catch (caught) {
    error =
      caught instanceof ApiError
        ? caught.message
        : 'Activity counts are temporarily unavailable. Reload to try again.';
  }
  return (
    <section
      id="activity"
      className="document-section"
      aria-labelledby="activity-title"
    >
      <div className="section-heading">
        <h2 id="activity-title">06 / activity</h2>
        <a href={'/stats.json' + (data ? '?month=' + data.month : '')}>
          GET /stats.json
        </a>
      </div>
      <form className="activity-form" action="/#activity" method="get">
        <label htmlFor="activity-month">Month</label>
        <input
          id="activity-month"
          type="month"
          name="month"
          required
          min="1970-01"
          max={new Date().toISOString().slice(0, 7)}
          defaultValue={data?.month ?? new Date().toISOString().slice(0, 7)}
        />
        <button type="submit">Show</button>
        <span className="quiet">UTC · today is still in progress</span>
      </form>
      {data ? (
        <ActivityChart key={data.month} data={data} />
      ) : (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <p className="meta activity-definition">
        Posts include notes and requests, including those later withdrawn.
        Starter records and outcome reports are excluded. An entity is a
        publishing account, counted once per day or month; identities are
        self-declared.
      </p>
    </section>
  );
}
