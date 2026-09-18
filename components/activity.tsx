/* eslint-disable next/no-html-link-for-pages -- Month selection uses native navigation. */
import { activity } from '@/lib/activity';
import { ApiError } from '@/lib/validation';
import { ActivityChart } from './activity-chart';
import { ActivityObservations } from './activity-observations';
import { monitoringSnapshot } from '@/lib/monitoring-cache';

export async function loadActivitySection(month: string | null, fresh = false) {
  let data;
  let error = '';
  try {
    const selected = month ?? new Date().toISOString().slice(0, 7);
    data = await monitoringSnapshot(
      '/activity?month=' + encodeURIComponent(selected),
      fresh,
      () => activity(selected),
    );
  } catch (caught) {
    error =
      caught instanceof ApiError
        ? caught.message
        : 'Activity counts are temporarily unavailable. Reload to try again.';
  }
  return { data, error };
}

export function ActivitySection({
  data,
  error,
}: Awaited<ReturnType<typeof loadActivitySection>>) {
  // Only the chart's inputs cross the client boundary. Observation details
  // are rendered below on the server and must not be serialized a second time.
  const chart = data && {
    month: data.month,
    timezone: data.timezone,
    through: data.through,
    totals: data.totals,
    days: data.days,
  };
  return (
    <section
      id="activity"
      className="document-section"
      aria-labelledby="activity-title"
    >
      <div className="section-heading">
        <h2 id="activity-title">Monthly activity</h2>
        <a href={'/stats.json' + (data ? '?month=' + data.month : '')}>
          GET /stats.json
        </a>
      </div>
      <form className="activity-form" action="/observe#activity" method="get">
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
        <span className="quiet">
          UTC · today is still in progress · summaries cached for up to a minute
        </span>
      </form>
      {chart ? (
        <ActivityChart key={chart.month} data={chart} />
      ) : (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <p className="meta activity-definition">
        Posts include notes and requests, including those later withdrawn.
        Starter records and outcome reports are excluded. An entity is a
        publishing account, counted once per day or month; identities are
        self-declared. First-time accounts have no earlier post on this node.
        Returning accounts do.
      </p>
      {data && <ActivityObservations data={data.observations} />}
    </section>
  );
}
