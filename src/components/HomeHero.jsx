import { Link } from 'react-router-dom';

// The hero is a continuation of the header band rather than something inside
// the page column, so it lives in the shell (App.jsx) and renders on the home
// route only. Two reasons it is not part of .site-header: that element is
// sticky, and a sticky band this tall would follow the reader down the page;
// and every other route wants the compact bar, with its list or form starting
// near the top rather than below a picture.
//
// The photograph is deliberately unscrimmed. The band and the image are the
// same temperature, so they sit together without one being tinted to match the
// other - laying teal over a warm photograph is what turns the quilts grey.
function HomeHero({ currentUser }) {
  return (
    <section aria-labelledby="home-hero-title" className="home-hero">
      <div className="home-hero-inner">
        <div className="home-hero-copy">
          <p className="home-hero-eyebrow">Events, activities &amp; membership</p>
          <h1 id="home-hero-title">The Village Quilters Network</h1>
          <p className="home-hero-lede">
            Classes, workshops, lectures, retreats and challenges &mdash; browse what is open,
            sign up, and keep track of what you are registered for.
          </p>
          <div className="home-hero-actions">
            <Link className="button-link hero-primary" to="/events">
              Browse activities
            </Link>
            {currentUser ? (
              <Link className="button-link hero-ghost" to="/my-registrations">
                My registrations
              </Link>
            ) : (
              <Link className="button-link hero-ghost" to="/login">
                Sign in
              </Link>
            )}
          </div>
        </div>

        <figure className="home-hero-figure">
          <img
            alt="The guild workroom: a pieced quilt over a drying rack, bolts of fabric stacked against the wall, and a cutting mat laid out on the work table."
            src="/assets/quilting-hero-studio-cool.jpg"
          />
        </figure>
      </div>
    </section>
  );
}

export default HomeHero;
