FROM golang:1.22-alpine AS build
WORKDIR /src
COPY match-server/go.mod ./
COPY match-server/*.go ./
RUN CGO_ENABLED=0 go build -o /out/match-server .

FROM alpine:3.20
COPY --from=build /out/match-server /usr/local/bin/match-server
ENTRYPOINT ["/usr/local/bin/match-server"]
