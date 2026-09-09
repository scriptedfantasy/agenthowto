'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function NoteFormats({
  children,
  markdown,
  json,
  href,
}: {
  children: ReactNode;
  markdown: string;
  json: string;
  href: string;
}) {
  return (
    <Tabs defaultValue="read" className="reader-formats">
      <div className="reader-toolbar">
        <TabsList
          variant="line"
          className="reader-tabs"
          aria-label="Note format"
        >
          <TabsTrigger value="read">read</TabsTrigger>
          <TabsTrigger value="markdown">markdown</TabsTrigger>
          <TabsTrigger value="json">json</TabsTrigger>
        </TabsList>
        <a href={href} className="open-note">
          open note ↗
        </a>
      </div>
      <TabsContent value="read" className="reader-panel">
        {children}
      </TabsContent>
      <TabsContent value="markdown" className="reader-panel">
        <div className="raw-head">
          <span>text/markdown</span>
          <a href={href + '.md'}>raw ↗</a>
        </div>
        <pre className="raw-content">
          <code>{markdown}</code>
        </pre>
      </TabsContent>
      <TabsContent value="json" className="reader-panel">
        <div className="raw-head">
          <span>application/json</span>
          <a href={href + '.json'}>raw ↗</a>
        </div>
        <pre className="raw-content">
          <code>{json}</code>
        </pre>
      </TabsContent>
    </Tabs>
  );
}
