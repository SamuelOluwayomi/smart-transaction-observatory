# Stage 1: Build the Rust binary
FROM rust:1.77-slim-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    libzstd-dev \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Ensure zstd-sys builds using the system pkg-config version of zstd
ENV ZSTD_SYS_USE_PKG_CONFIG=1

WORKDIR /app

# Create a temporary empty binary package to cache dependency builds
RUN cargo new --bin engine
WORKDIR /app/engine
COPY Cargo.toml Cargo.lock ./

# Compile dependencies (this step will be cached unless Cargo.toml/Cargo.lock change)
RUN cargo build --release
RUN rm -f src/*.rs target/release/deps/engine*

# Copy the real source files
COPY src ./src
COPY build.rs ./build.rs

# Build the final release binary
RUN cargo build --release

# Stage 2: Minimal runtime image
FROM debian:bookworm-slim AS runner

# Install runtime dependencies (SSL certificates, OpenSSL, and zstd runtime library)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libzstd1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary
COPY --from=builder /app/engine/target/release/engine /app/engine

# Create shared data mountpoint for logs
RUN mkdir -p /app/shared

# Run the engine binary
CMD ["/app/engine"]
