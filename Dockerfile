FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-opencv python3-numpy ffmpeg ca-certificates gzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN gzip -dk camera-engine/camera_motion.py.gz && /usr/bin/python3 -c "import cv2,numpy; print('camera-engine',cv2.__version__)"
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["npm","start"]
