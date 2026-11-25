import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { useStore } from '@/lib/store';
import { buildCustomerCsv, buildDecisions, buildLogsCsv, buildReadme, buildReconciliationCsv, buildReport, buildUnderstanding } from '@/lib/reports';
import { dateTime } from '@/lib/format';

export function ReportsPage() {
  const { world, findings, reconciliation, fixRun, customerRows, recentLogs, baseline, pushToast } = useStore();
  const generatedAt = new Date().toISOString();

  const files = useMemo(() => {
    const inputs = { world, findings, reconciliation: reconciliation ?? baseline, fixRun, customerRows, generatedAt };
    return [
      { filename: 'UNDERSTANDING.md', label: 'Understanding', description: 'Architecture, workflow, observations, root-cause hypotheses, evidence, and implementation plan.', body: buildUnderstanding(inputs) },
      { filename: 'DECISIONS.md', label: 'Decisions', description: 'Chronological decisions, discovered evidence, changed hypotheses, and trade-offs.', body: buildDecisions(inputs) },
      { filename: 'REPORT.md', label: 'Report', description: 'Gap breakdown, fixes and proof, customers paid twice, CFO note, and open gaps — six fixed sections.', body: buildReport(inputs) },
      { filename: 'README.md', label: 'Readme', description: 'Project setup, live workspace snapshot, architecture, API, and testing instructions.', body: buildReadme(inputs) },
    ];
  }, [world, findings, reconciliation, fixRun, customerRows, baseline, generatedAt]);

  const [selected, setSelected] = useState(0);
  const file = files[selected];

  const download = (filename: string, content: string, mime = 'text/markdown') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    for (const f of files) download(f.filename, f.body);
    download('customers-recovery.csv', buildCustomerCsv(customerRows), 'text/csv');
    download(`reconciliation-${(reconciliation ?? baseline).id}.csv`, buildReconciliationCsv(reconciliation ?? baseline, world.refunds), 'text/csv');
    download('worker-logs.csv', buildLogsCsv(recentLogs), 'text/csv');
    pushToast('success', 'All reports and CSV evidence downloaded');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reports & Documentation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Generated from actual reconciliation findings and verified fix results — financial totals are never invented.</p>
        </div>
        <Button variant="secondary" onClick={downloadAll}><Download size={15} /> Download all</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-3">
          {files.map((f, i) => (
            <button
              key={f.filename}
              onClick={() => setSelected(i)}
              className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${i === selected ? 'border-blue-300 bg-blue-50 shadow-card' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-2">
                <FileText size={16} className={i === selected ? 'text-blue-600' : 'text-slate-400'} />
                <span className={`text-sm font-semibold ${i === selected ? 'text-blue-800' : 'text-slate-700'}`}>{f.label}</span>
                <span className="ml-auto text-[10px] text-slate-400">{f.filename}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">{f.description}</p>
            </button>
          ))}
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Report basis</p>
            <div className="mt-2 space-y-1.5 text-xs text-slate-600">
              <p className="flex justify-between"><span>Findings</span><span className="font-medium tabular">{findings.length}</span></p>
              <p className="flex justify-between"><span>Reconciliation run</span><span className="font-medium">{(reconciliation ?? baseline).id}</span></p>
              <p className="flex justify-between"><span>Corrected fix run</span><span className="font-medium">{fixRun ? fixRun.id : 'not executed'}</span></p>
              <p className="flex justify-between"><span>Dataset</span><span className="font-medium">{world.refunds.length} refunds</span></p>
            </div>
            <p className="mt-3 text-[10px] text-slate-400">Generated {dateTime(generatedAt)} · simulation environment</p>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-800">{file.filename}</span>
              <Badge value="INFO" label="MARKDOWN" />
            </div>
            <Button size="sm" variant="secondary" onClick={() => download(file.filename, file.body)}><Download size={13} /> Download</Button>
          </div>
          <div className="px-5 py-4 max-h-[36rem] overflow-y-auto">
            <MarkdownView body={file.body} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function MarkdownView({ body }: { body: string }) {
  const blocks = body.split('\n');
  return (
    <div className="space-y-1">
      {blocks.map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold text-slate-800 pt-4">{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={i} className="text-lg font-semibold text-slate-900 pb-1">{line.slice(2)}</h2>;
        if (line.startsWith('- ')) {
          const text = line.slice(2).replace(/\*\*(.+?)\*\*/g, '$1');
          return <p key={i} className="text-xs text-slate-600 flex gap-2"><span className="text-slate-300">•</span>{text}</p>;
        }
        if (/^\d+\./.test(line)) {
          const text = line.replace(/^\d+\.\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1');
          return <p key={i} className="text-xs text-slate-600 flex gap-2"><span className="font-medium text-slate-400">{line.match(/^\d+/)?.[0]}.</span>{text}</p>;
        }
        if (line.trim() === '') return <div key={i} className="h-1.5" />;
        return <p key={i} className="text-xs text-slate-600 leading-relaxed">{line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1')}</p>;
      })}
    </div>
  );
}
