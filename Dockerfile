FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --allow-remote=all --ignore-scripts

COPY . .

EXPOSE 3000

CMD ["npm", "start"]