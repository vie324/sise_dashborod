import { useState } from 'react';
import { PageHeader, Segmented } from '../../ui/primitives.jsx';
import Counseling from './counseling/Counseling.jsx';
import PostureAnalysis from './posture/PostureAnalysis.jsx';
import TreatmentReport from './report/TreatmentReport.jsx';

// ============================================================
// 施術ツール: カウンセリング / 姿勢分析 / 施術レポート
// ------------------------------------------------------------
// 来店の流れ（カウンセリング → 施術前の姿勢チェック → 施術後のレポート）の順に並べる。
// どれも表示を切り替えるだけで中身は残す（施術前の Before 写真を撮った後に
// レポート側を開いても消えないように）。最後に開いていたものを覚えておく。
// ============================================================

const TOOL_KEY = 'sise_care_tool';
const TOOLS = [
  { value: 'counseling', label: 'カウンセリング', icon: 'clipboard-check' },
  { value: 'posture', label: '姿勢分析', icon: 'person-standing' },
  { value: 'report', label: '施術レポート', icon: 'clipboard-list' },
];

function readTool() {
  try {
    const v = localStorage.getItem(TOOL_KEY);
    return TOOLS.some((t) => t.value === v) ? v : 'counseling';
  } catch (_) {
    return 'counseling';
  }
}

export default function CarePage() {
  const [tool, setTool] = useState(readTool);

  const changeTool = (next) => {
    setTool(next);
    try { localStorage.setItem(TOOL_KEY, next); } catch (_) { /* noop */ }
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <PageHeader
        title="施術ツール"
        subtitle="カウンセリングシートの確認・プランのご提案、姿勢分析、施術レポートの作成ができます"
        actions={<Segmented value={tool} onChange={changeTool} options={TOOLS} ariaLabel="ツールの切り替え" />}
      />
      <div hidden={tool !== 'counseling'}>
        <Counseling active={tool === 'counseling'} onOpenTool={changeTool} />
      </div>
      <div hidden={tool !== 'posture'}>
        <PostureAnalysis active={tool === 'posture'} />
      </div>
      <div hidden={tool !== 'report'}>
        <TreatmentReport active={tool === 'report'} />
      </div>
    </>
  );
}
