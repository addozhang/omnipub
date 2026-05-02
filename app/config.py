from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "omnipub"
    DEBUG: bool = False

    DATABASE_URL: str = "sqlite+aiosqlite:///./omnipub.db"

    # WARNING: override SECRET_KEY via environment in production.
    SECRET_KEY: str = "dev-secret-key-do-not-use-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_DAYS: int = 7
    CHROME_SESSION_EXPIRE_DAYS: int = 30

    # Rate limiting: disable in CI/test environments where many
    # registrations happen in quick succession.
    RATE_LIMIT_ENABLED: bool = True

    # Comma-separated list of allowed CORS origins.
    # In production, set e.g. CORS_ORIGINS="https://omnipub.example.com"
    CORS_ORIGINS: str = "*"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")


settings = Settings()
