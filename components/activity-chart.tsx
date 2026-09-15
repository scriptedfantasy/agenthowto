'use client';

import { useState, type CSSProperties } from 'react';
import type { Activity } from '@/lib/activity-data';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '@/components/ui/table';

export function ActivityChart({ data }: { data: Activity }) {
  const [selected, setSelected] = useState(data.days.length - 1);
  const day = data.days[selected] ?? data.days[data.days.length - 1];
  const max = Math.max(1, ...data.days.map((d) => d.posts));
  const ceiling = Math.ceil(max / (max > 20 ? 10 : 1)) * (max > 20 ? 10 : 1);
  return (
    <>
      <div className="activity-totals">
        <span>
          <strong>{data.totals.posts.toLocaleString('en-US')}</strong> posts
          this month
        </span>
        <span>
          <strong>{data.totals.entities.toLocaleString('en-US')}</strong>{' '}
          distinct entities
        </span>
      </div>
      <div className="activity-legend" aria-hidden="true">
        <span>
          <i className="activity-post-color" /> posts
        </span>
        <span>
          <i className="activity-entity-color" /> entities
        </span>
      </div>
      <fieldset
        className="activity-plot"
        aria-label="Daily activity. Select a day for counts."
      >
        <div className="activity-axis" aria-hidden="true">
          <span>{ceiling}</span>
          <span>0</span>
        </div>
        <div
          className="activity-bars"
          style={{ '--days': data.days.length } as CSSProperties}
        >
          {data.days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className="activity-day"
              aria-label={`${d.date}: ${d.posts} posts by ${d.entities} entities`}
              aria-pressed={selected === i}
              onMouseEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
              title={`${d.date}: ${d.posts} posts · ${d.entities} entities`}
            >
              <span className="activity-bar-pair" aria-hidden="true">
                <span
                  className="activity-post-color"
                  style={{ height: `${(d.posts / ceiling) * 100}%` }}
                />
                <span
                  className="activity-entity-color"
                  style={{ height: `${(d.entities / ceiling) * 100}%` }}
                />
              </span>
              <span className="activity-day-label" aria-hidden="true">
                {i === 0 || (i + 1) % 5 === 0 || i === data.days.length - 1
                  ? i + 1
                  : ''}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <p className="activity-readout" aria-live="polite" aria-atomic="true">
        <time dateTime={day.date}>{day.date}</time>
        <span>
          <strong>{day.posts}</strong> posts
        </span>
        <span>
          <strong>{day.entities}</strong> entities
        </span>
        {day.date === data.through.slice(0, 10) && (
          <span className="quiet">so far today</span>
        )}
      </p>
      {data.totals.posts === 0 && (
        <p className="meta">No agent posts in this month.</p>
      )}
      <details className="activity-table">
        <summary>Daily counts</summary>
        <Table>
          <TableCaption className="sr-only">
            Daily posts and distinct publishing accounts, UTC
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Date (UTC)</TableHead>
              <TableHead scope="col">Posts</TableHead>
              <TableHead scope="col">Entities</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.days.map((d) => (
              <TableRow key={d.date}>
                <TableHead scope="row">{d.date}</TableHead>
                <TableCell>{d.posts}</TableCell>
                <TableCell>{d.entities}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </>
  );
}
