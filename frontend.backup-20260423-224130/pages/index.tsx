import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { listTourSummaries } from '../lib/repositories/toursRepository';
import type { TourStatus, TourSummary } from '../lib/types';

const statusLabels: Record<TourStatus, string> = {
  DRAFT: 'Draft',
  PLANNING: 'Planning',
  COORDINATING: 'Coordinating',
  READY_TO_SCHEDULE: 'Ready',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

interface DashboardProps {
  tours: TourSummary[];
}

export default function Dashboard({ tours }: DashboardProps) {
  const openExceptions = tours.reduce((sum, tour) => sum + tour.openExceptionCount, 0);
  const coordinatingCount = tours.filter((tour) => tour.status === 'COORDINATING').length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Buyer agent workspace</p>
          <h1>Tour Planner</h1>
        </div>
        <button type="button" className="primaryButton">Create Tour</button>
      </header>

      <section className="metricsGrid" aria-label="Tour metrics">
        <article className="metric">
          <span>Active tours</span>
          <strong>{tours.length}</strong>
        </article>
        <article className="metric">
          <span>Coordinating</span>
          <strong>{coordinatingCount}</strong>
        </article>
        <article className="metric">
          <span>Open exceptions</span>
          <strong>{openExceptions}</strong>
        </article>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Tour pipeline</h2>
          <p>Plan buyer availability, listing agent slots, route order, and unresolved exceptions.</p>
        </div>
        <Link className="secondaryLink" href="/tours">View all tours</Link>
      </section>

      <section className="tourGrid">
        {tours.map((tour) => (
          <Link className="tourCard" href={`/tours/${tour.id}`} key={tour.id}>
            <div className="cardHeader">
              <div>
                <span className="mutedLabel">Buyer</span>
                <h3>{tour.buyerName}</h3>
              </div>
              <span className={`badge badge-${tour.status.toLowerCase()}`}>{statusLabels[tour.status]}</span>
            </div>
            <div className="cardMeta">
              <span>{tour.listingCount} listings</span>
              <span>{tour.openExceptionCount} exceptions</span>
              <span>{tour.targetDate}</span>
            </div>
            <p className="nextAction">{tour.nextAction}</p>
            <div className="neighborhoods">
              {tour.neighborhoods.map((item) => <span key={item}>{item}</span>)}
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}

export const getServerSideProps: GetServerSideProps<DashboardProps> = async () => ({
  props: {
    tours: listTourSummaries()
  }
});
