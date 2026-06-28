# ============================================
# Stage 1: Build — 编译 native 模块 + 构建前端
# ============================================
FROM node:20-slim AS build

# 华为镜像源 — npm/pnpm
RUN echo "registry=https://mirrors.huaweicloud.com/repository/npm/" > /root/.npmrc

# 华为镜像源 — apt
RUN echo "Types: deb" > /etc/apt/sources.list.d/debian.sources && \
    echo "URIs: http://mirrors.huaweicloud.com/debian" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Suites: bookworm bookworm-updates" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Components: main" >> /etc/apt/sources.list.d/debian.sources && \
    echo "" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Types: deb" >> /etc/apt/sources.list.d/debian.sources && \
    echo "URIs: http://mirrors.huaweicloud.com/debian-security" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Suites: bookworm-security" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Components: main" >> /etc/apt/sources.list.d/debian.sources

# 编译工具链（仅构建期需要，不会进入最终镜像）
RUN apt-get update && apt-get install -y \
    python3 make gcc g++ tar \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 跳过 Puppeteer 浏览器下载（运行时用系统 chromium）
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# 安装全部依赖（含 devDeps，构建前端需要）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile && \
    pnpm rebuild better-sqlite3

# 构建前端
COPY . .
RUN pnpm build

# 裁剪 devDependencies，减少向 Runtime 阶段复制的体积
RUN pnpm prune --prod

# ============================================
# Stage 2: Runtime — 最小运行镜像
# ============================================
FROM node:20-slim

# 华为镜像源 — apt
RUN echo "Types: deb" > /etc/apt/sources.list.d/debian.sources && \
    echo "URIs: http://mirrors.huaweicloud.com/debian" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Suites: bookworm bookworm-updates" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Components: main" >> /etc/apt/sources.list.d/debian.sources && \
    echo "" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Types: deb" >> /etc/apt/sources.list.d/debian.sources && \
    echo "URIs: http://mirrors.huaweicloud.com/debian-security" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Suites: bookworm-security" >> /etc/apt/sources.list.d/debian.sources && \
    echo "Components: main" >> /etc/apt/sources.list.d/debian.sources

# 仅安装运行时需要的系统包
# chromium: PDF 导出 | fonts-noto-cjk: 中文 PDF 渲染必需（含 Noto Sans SC）
# sqlite3: 数据库调试工具
RUN apt-get update && apt-get install -y \
    chromium fonts-noto-cjk sqlite3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# 从构建阶段复制产物
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./

ENV PATH="/app/node_modules/.bin:$PATH"
EXPOSE 3000
CMD ["tsx", "server/index.ts"]