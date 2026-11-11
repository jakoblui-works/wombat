/** What an activity that isn't built yet shows in its sidebar. */
export const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div>
    <h2>{title}</h2>
    <p>{body}</p>
  </div>
);
