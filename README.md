# CricLive

A cricket live score and information platform built with HTML and JavaScript frontend, backed by a Node.js backend.

## 🏏 Overview

CricLive is a web application designed to provide live cricket scores, match updates, and cricket-related information. The project follows a full-stack architecture with separate frontend and backend implementations.

## 📋 Features

- **Live Score Updates**: Track cricket matches in real-time
- **Match Information**: Get detailed information about ongoing and upcoming matches
- **Responsive Design**: Modern, user-friendly interface

## 🏗️ Project Structure

```
criclive/
├── frontend/          # Frontend application (HTML/JavaScript)
├── backend/           # Backend API server
├── .env.example       # Environment configuration template
├── .gitignore         # Git ignore rules
└��─ README.md          # This file
```

## 🛠️ Tech Stack

- **Frontend**: HTML (85.4%), JavaScript (14.6%)
- **Backend**: Node.js
- **Environment**: Configured via `.env` file

## 📦 Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/sumeetp4/criclive.git
   cd criclive
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Update the `.env` file with your configuration settings.

3. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

4. **Install backend dependencies**
   ```bash
   cd ../backend
   npm install
   ```

## 🚀 Getting Started

### Running the Backend
```bash
cd backend
npm start
```

### Running the Frontend
```bash
cd frontend
npm start
```

The application will be available at `http://localhost:3000` (or as configured in your `.env` file).

## 📝 Environment Configuration

Refer to `.env.example` for the required environment variables. Copy this file to `.env` and update with your specific configuration:

```bash
cp .env.example .env
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is currently unlicensed. Please add a LICENSE file if you'd like to specify licensing terms.

## 📧 Contact

For questions or suggestions, feel free to reach out to the project maintainer or open an issue in the repository.

---

**Happy scoring! 🏏**