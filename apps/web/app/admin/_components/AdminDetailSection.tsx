import Section from "../../components/ui/Section";

export default function AdminDetailSection({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Section title={title} description={description} className="settingsSection adminDetailSection">
      {children}
    </Section>
  );
}
