import { Modal } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { ScorePill } from './ScoreBits.jsx';

// 各項目のスコア基準になっている査読付き論文
export default function ReferenceModal({ item, onClose }) {
  const ref = item && item.reference;
  return (
    <Modal open={!!ref} onClose={onClose} title={item ? item.label : ''} size="sm">
      {ref ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ScorePill score={item.score} />
            <span className="text-sm text-ink-2">
              {item.detail} — {item.value}{item.valueCm ? `（約${item.valueCm}）` : ''}
            </span>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-brand-700 dark:text-brand-300">
              <Icon name="book-open" size={14} />査読付き学術論文
            </p>
            <dl className="space-y-1.5 text-xs leading-relaxed text-ink-2">
              <div><dt className="inline font-bold text-ink">著者: </dt><dd className="inline">{ref.authors}</dd></div>
              <div><dt className="inline font-bold text-ink">年: </dt><dd className="inline">{ref.year}</dd></div>
              <div><dt className="inline font-bold text-ink">ジャーナル: </dt><dd className="inline">{ref.journal}</dd></div>
              {ref.doi ? (
                <div>
                  <dt className="inline font-bold text-ink">DOI: </dt>
                  <dd className="inline">
                    <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline dark:text-brand-300">{ref.doi}</a>
                  </dd>
                </div>
              ) : null}
              {ref.pmid ? (
                <div>
                  <dt className="inline font-bold text-ink">PubMed: </dt>
                  <dd className="inline">
                    <a href={`https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/`} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">PMID: {ref.pmid}</a>
                  </dd>
                </div>
              ) : null}
              <div className="border-t border-line pt-2">
                <dt className="inline font-bold text-ink">知見: </dt><dd className="inline">{ref.finding}</dd>
              </div>
            </dl>
          </div>
          <p className="text-center text-[11px] text-muted">本スコアリングは上記の Peer-Reviewed 論文に基づいています</p>
        </div>
      ) : null}
    </Modal>
  );
}
