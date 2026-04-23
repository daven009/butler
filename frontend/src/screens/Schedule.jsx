import { useEffect, useMemo, useState } from 'react';
import BottomTabs from '../components/BottomTabs';
import { useButler } from '../context/ButlerContext';
import { calendarApi } from '../lib/api';
import { AB } from '../data';
import { useAppNav } from '../navigation';

const monthLabel = 'April 2026';
const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildMonthDays() {
  const firstDayIndex = 2;
  const daysInMonth = 30;
  const cells = [];

  for (let index = 0; index < firstDayIndex; index += 1) {
    cells.push({ key: `empty-${index}`, empty: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `2026-04-${String(day).padStart(2, '0')}`;
    cells.push({ key: iso, iso, day, count: SCHEDULES[iso]?.length || 0 });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, empty: true });
  }

  return cells;
}

const toneStyles = {
  confirmed: { bg: '#E9F5F1', text: '#006A5B', label: 'Confirmed' },
  hold: { bg: '#FFF4DB', text: '#8B5A00', label: 'Hold' },
  pending: { bg: '#F1F1F1', text: AB.gray, label: 'Pending' },
};

export default function Schedule() {
  const nav = useAppNav();
  const { setActiveTourId } = useButler();
  const [selectedDate, setSelectedDate] = useState('2026-04-19');
  const [calendarItems, setCalendarItems] = useState([]);
  const calendarDays = useMemo(() => {
    const counts = calendarItems.reduce((acc, item) => {
      acc[item.date] = (acc[item.date] || 0) + 1;
      return acc;
    }, {});
    return buildMonthDays().map((cell) => cell.empty ? cell : { ...cell, count: counts[cell.iso] || 0 });
  }, [calendarItems]);
  const selectedEvents = calendarItems.filter((item) => item.date === selectedDate);
  const selectedDayNumber = selectedDate.slice(-2);

  useEffect(() => {
    calendarApi.month('2026-04').then((response) => setCalendarItems(response.items || [])).catch(() => setCalendarItems([]));
  }, []);

  return (
    <div className="screen screen--bg">
      <header className="screen-header screen-header--bg">
        <h1 className="screen-title">Confirmed viewings</h1>
        <div className="screen-subtitle">See the month at a glance and tap any date to inspect that day’s route.</div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 20px 0' }}>
        <div style={{ background: AB.white, borderRadius: 22, border: `1px solid ${AB.border}`, padding: 18, boxShadow: '0 12px 30px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{monthLabel}</div>
            <div style={{ padding: '6px 10px', borderRadius: 999, background: '#FFF1F4', color: AB.rausch, fontSize: 11, fontWeight: 700 }}>
              7 scheduled stops
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 10 }}>
            {weekdayLabels.map((label) => (
              <div key={label} style={{ textAlign: 'center', fontSize: 11, color: AB.gray, fontWeight: 700, letterSpacing: 0.4 }}>
                {label}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {calendarDays.map((cell) => {
              if (cell.empty) {
                return <div key={cell.key} style={{ aspectRatio: '1 / 1' }} />;
              }

              const active = cell.iso === selectedDate;
              const hasEvents = cell.count > 0;

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDate(cell.iso)}
                  style={{
                    aspectRatio: '1 / 1',
                    border: `1px solid ${active ? AB.rausch : hasEvents ? '#FFD2DB' : AB.border}`,
                    borderRadius: 16,
                    background: active ? '#FFF1F4' : AB.white,
                    color: active ? AB.rausch : AB.ink,
                    display: 'grid',
                    placeItems: 'center',
                    padding: 0,
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{cell.day}</span>
                  {hasEvents && <span style={{ position: 'absolute', bottom: 8, width: 6, height: 6, borderRadius: '50%', background: active ? AB.rausch : '#FF8AA0' }} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 20px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: AB.gray, letterSpacing: 0.8, textTransform: 'uppercase' }}>Day plan</div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 22, fontWeight: 600, marginTop: 3 }}>Apr {selectedDayNumber}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              const firstTourId = selectedEvents[0]?.tourId;
              if (firstTourId) setActiveTourId(firstTourId);
              nav('tour');
            }}
            style={{ border: `1px solid ${AB.border}`, borderRadius: 999, background: AB.white, padding: '9px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Open active tour
          </button>
        </div>

        {selectedEvents.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {selectedEvents.map((event) => {
              const tone = toneStyles[event.tone] || toneStyles.pending;
              return (
                <div key={`${event.time}-${event.title}`} style={{ background: AB.white, borderRadius: 18, border: `1px solid ${AB.border}`, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 24, fontWeight: 600, letterSpacing: -0.3 }}>{event.time}</div>
                      <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 4 }}>{event.buyer}</div>
                    </div>
                    <div style={{ padding: '6px 10px', borderRadius: 999, background: tone.bg, color: tone.text, fontSize: 11, fontWeight: 700 }}>
                      {tone.label}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginTop: 14 }}>{event.title}</div>
                  <div style={{ fontSize: 13, color: AB.gray, marginTop: 4 }}>{event.detail}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ background: AB.white, borderRadius: 18, border: `1px solid ${AB.border}`, padding: 18, fontSize: 13.5, color: AB.gray, lineHeight: 1.6 }}>
            No confirmed stops on this date yet. Butler will surface new appointments here as soon as agents reply.
          </div>
        )}
        </div>
      </div>

      <BottomTabs active="schedule" nav={nav} />
    </div>
  );
}
