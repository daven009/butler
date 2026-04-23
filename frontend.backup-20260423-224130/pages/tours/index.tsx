import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { listTourSummaries } from '../../lib/repositories/toursRepository';
import type { TourSummary } from '../../lib/types';

interface ToursPageProps {
  tours: TourSummary[];
}

export default function ToursPage({ tours }: ToursPageProps) {

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">All tours</p>
          <h1>Tour queue</h1>
        </div>
        <Link className="secondaryLink" href="/">Dashboard</Link>
      </header>

      <section className="tableCard">
        <div className="tableRow tableHead">
          <span>Buyer</span>
          <span>Status</span>
          <span>Listings</span>
          <span>Exceptions</span>
          <span>Next action</span>
        </div>
        {tours.map((tour) => (
          <Link className="tableRow tableLink" href={`/tours/${tour.id}`} key={tour.id}>
            <strong>{tour.buyerName}</strong>
            <span>{tour.status.replaceAll('_', ' ')}</span>
            <span>{tour.listingCount}</span>
            <span>{tour.openExceptionCount}</span>
            <span>{tour.nextAction}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}

export const getServerSideProps: GetServerSideProps<ToursPageProps> = async () => ({
  props: {
    tours: listTourSummaries()
  }
});
