import { ExperienceCard } from "./experience-card";
import { DESTINATION_IMAGES } from "./destination-image";

// Favorites section (❤️ المفضلة). Same honesty note as every other
// dashboard section: no real Favorites/Saved data model exists in this
// project yet — documented here in code, not surfaced as a visible
// label in the UI.

const favorites = [
  { title: "قلعة نزوى التاريخية", location: "نزوى، عُمان", providerName: "تراث عُمان", price: "20 ر.ع", rating: 4.5, duration: "ساعتان", category: "تراث", imageSrc: DESTINATION_IMAGES.jebelAkhdar },
  { title: "جولة وادي شاب", location: "الشرقية، عُمان", providerName: "مغامرات عُمان", price: "35 ر.ع", rating: 4.7, duration: "5 ساعات", category: "مغامرات", imageSrc: DESTINATION_IMAGES.wadiDarbat },
  { title: "رحلة صحراء الشرقية", location: "الشرقية، عُمان", providerName: "دروب الصحراء", price: "60 ر.ع", rating: 4.6, duration: "يوم كامل", category: "صحراء", imageSrc: DESTINATION_IMAGES.sharqiyaSands },
];

export function FavoritesSection() {
  return (
    <div>
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>❤️</span>
        المفضلة
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {favorites.map((experience) => (
          <ExperienceCard key={experience.title} {...experience} />
        ))}
      </div>
    </div>
  );
}
