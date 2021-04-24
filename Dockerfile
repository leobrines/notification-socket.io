FROM node:10-alpine

COPY package.json /src/package.json
COPY server.js /src/server.js

WORKDIR /src
RUN npm install
EXPOSE 3000
CMD ["node", "server.js"]
