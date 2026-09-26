import type { BillData } from '../domain/bill';
import { S, t } from '../i18n';
import { formatMoney, formatStamp } from '../lib/numbers';

/**
 * The 80mm receipt, printed straight from the browser so the counter tablet can send
 * it to a roll printer or save a PDF to share. Black and white only — thermal paper
 * has no colour — and no signature lines, because nobody signs at this counter.
 */
export function Bill({ data, onClose }: { data: BillData; onClose(): void }) {
  const brought = data.items.filter((i) => i.side === 'in');
  const taken = data.items.filter((i) => i.side === 'out');
  const bothSides = brought.length > 0 && taken.length > 0;
  const net = Number(data.net);

  return (
    <div className="stack bill-wrap">
      <article className="bill" id="bill-print">
        <h1 className="bill__mill">{S.mill.name}</h1>
        <p className="bill__addr">{S.mill.address}</p>
        <p className="bill__trade">{S.mill.trade}</p>
        <p className="bill__contact">
          <span>{S.mill.phone}</span>
          <span>{S.mill.regNo}</span>
        </p>

        <div className="bill__meta">
          <span>{data.billNo}</span>
          <span>{formatStamp(data.at)}</span>
        </div>
        {data.customerName && (
          <p className="bill__who">
            {data.customerName}
            {data.customerPhone ? ` · ${data.customerPhone}` : ''}
          </p>
        )}

        {brought.length > 0 && (
          <section className="bill__sec">
            <h3 className="bill__secTitle">{bothSides ? S.bill.brought : S.bill.purchaseTitle}</h3>
            {brought.map((item, i) => (
              <Line key={`in${i}`} item={item} />
            ))}
          </section>
        )}

        {taken.length > 0 && (
          <section className="bill__sec">
            <h3 className="bill__secTitle">
              {data.kind === 'payment' ? S.bill.paymentTitle : bothSides ? S.bill.taken : S.bill.saleTitle}
            </h3>
            {taken.map((item, i) => (
              <Line key={`out${i}`} item={item} />
            ))}
          </section>
        )}

        {/* Only a two-sided visit needs the subtraction spelled out. */}
        {bothSides && (
          <div className="bill__sum">
            <span>{S.bill.broughtTotal}</span>
            <span>{formatMoney(data.inTotal)}</span>
            <span>{S.bill.takenTotal}</span>
            <span>− {formatMoney(data.outTotal)}</span>
          </div>
        )}

        <div className="bill__net">
          <span className="bill__netLabel">{data.kind === 'payment' ? S.bill.received : S.bill.payable}</span>
          <span className="bill__netAmt">{formatMoney(Math.abs(net).toFixed(2))}</span>
        </div>
        {data.how && <p className="bill__how">{data.how}</p>}

        {data.conversion && (
          <div className="bill__conv">
            <p className="bill__convTitle">{t(S.bill.ifKgIs, { amount: formatMoney(data.conversion.kgPrice) })}</p>
            <div>
              <span>{S.bill.perBottle}</span>
              <span>{formatMoney(data.conversion.bottle)}</span>
            </div>
            <div>
              <span>{S.bill.perLiter}</span>
              <span>{formatMoney(data.conversion.liter)}</span>
            </div>
          </div>
        )}

        {data.debtAfter !== null && (
          <div className="bill__debt">
            <div>
              <span>{S.bill.debtBefore}</span>
              <span>{formatMoney(data.debtBefore ?? '0')}</span>
            </div>
            <div>
              <span>{S.bill.debtAfter}</span>
              <span>{formatMoney(data.debtAfter)}</span>
            </div>
          </div>
        )}

        <p className="bill__foot">{S.bill.thanks}</p>
      </article>

      <div className="field-row bill__actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {S.bill.close}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          {S.bill.print}
        </button>
      </div>
    </div>
  );
}

function Line({ item }: { item: BillData['items'][number] }) {
  return (
    <div className="bill__row">
      <span className="bill__rowName">{item.name}</span>
      {item.detail && <span className="bill__rowQty">{item.detail}</span>}
      {item.how && <span className="bill__rowHow">{item.how}</span>}
      <span className="bill__rowAmt">{formatMoney(item.amount)}</span>
    </div>
  );
}
