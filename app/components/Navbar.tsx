import {Link} from "react-router";

const Navbar = () => {
    return (
        <nav className="navbar">
            <Link to="/" className="flex items-center gap-2">
                {/* <p className="text-2xl font-bold text-gradient">RESUMIND</p> */}
                <img src="/logo.svg" alt="MockMate AI" className="w-8 h-8" />
                <p className="text-2xl font-bold text-gradient">MockMate AI</p>
            </Link>
            <Link to="/upload" className="primary-button w-fit">
                Upload Resume
            </Link>
        </nav>
    )
}
export default Navbar
