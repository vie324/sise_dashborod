import { useState } from 'react';
import { PageHeader, Segmented } from '../../ui/primitives.jsx';
import PostureAnalysis from './posture/PostureAnalysis.jsx';
import TreatmentReport from './report/TreatmentReport.jsx';

// ============================================================
// 施術ツール: 姿勢分析 / 施術レポート
// ------------------------------------------------------------
// 両方とも表示を切り替えるだけで中身は残す（施術前の Before 写真を撮った後に
// レポート側を開いても消えないように）。最後に開いていた方を覚えておく。
// ============================================================

const TOOL_KEY = 'sise_care_tool';
const TOOLS = [
  { value: 'posture', label: '姿勢分析', icon: 'person-standing' },
  { value: 'report', label: '施術レポート', icon: 'clipboard-list' },
];

function readTool() {
  try {
    const v = localStorage.getItem(TOOL_KEY);
    return TOOLS.some((t) => t.value === v) ? v : 'posture';
  } catch (_) {
    return 'posture';
  }
}

export default function CarePage() {
  const [tool, setTool] = useState(readTool);

  const changeTool = (next) => {
    setTool(next);
    try { localStorage.setItem(TOOL_KEY, next); } catch (_) { /* noop */ }
  };

  return (
    <>
      <PageHeader
        title="施術ツール"
        subtitle="姿勢分析と施術レポートを作成して、画像で保存・共有・印刷できます"
        actions={<Segmented value={tool} onChange={changeTool} options={TOOLS} ariaLabel="ツールの切り替え" />}
      />
      <div hidden={tool !== 'posture'}>
        <PostureAnalysis active={tool === 'posture'} />
      </div>
      <div hidden={tool !== 'report'}>
        <TreatmentReport active={tool === 'report'} />
      </div>
    </>
  );
}
