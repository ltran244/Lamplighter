\restrict dbmate

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alert_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text DEFAULT 'email'::text NOT NULL,
    target text NOT NULL,
    CONSTRAINT alert_channels_target_check CHECK ((length(TRIM(BOTH FROM target)) > 0)),
    CONSTRAINT alert_channels_type_check CHECK ((type = 'email'::text))
);


--
-- Name: check_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    monitor_id uuid NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    actual_start timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    status_code integer,
    latency_ms integer NOT NULL,
    ok boolean NOT NULL,
    error text,
    worker_id text NOT NULL,
    CONSTRAINT check_runs_finished_at_check CHECK ((finished_at >= actual_start)),
    CONSTRAINT check_runs_latency_ms_check CHECK ((latency_ms >= 0)),
    CONSTRAINT check_runs_status_code_check CHECK (((status_code >= 100) AND (status_code <= 599)))
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    monitor_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    cause text NOT NULL,
    CONSTRAINT incidents_resolved_at_check CHECK ((resolved_at >= started_at))
);


--
-- Name: monitor_headers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitor_headers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    monitor_id uuid NOT NULL,
    name text NOT NULL,
    value_encrypted bytea NOT NULL,
    is_secret boolean DEFAULT true NOT NULL,
    CONSTRAINT monitor_headers_name_check CHECK ((name ~ '^[!#$%&''*+.^_`|~0-9A-Za-z-]+$'::text))
);


--
-- Name: COLUMN monitor_headers.value_encrypted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.monitor_headers.value_encrypted IS 'Versioned encrypted header value. Encryption keys are held outside the database.';


--
-- Name: monitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    method text DEFAULT 'GET'::text NOT NULL,
    interval_seconds integer DEFAULT 60 NOT NULL,
    timeout_ms integer DEFAULT 10000 NOT NULL,
    expected_status integer DEFAULT 200 NOT NULL,
    paused boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_until timestamp with time zone,
    CONSTRAINT monitors_consecutive_failures_check CHECK ((consecutive_failures >= 0)),
    CONSTRAINT monitors_expected_status_check CHECK (((expected_status >= 100) AND (expected_status <= 599))),
    CONSTRAINT monitors_interval_seconds_check CHECK ((interval_seconds >= 30)),
    CONSTRAINT monitors_method_check CHECK ((method = ANY (ARRAY['GET'::text, 'HEAD'::text]))),
    CONSTRAINT monitors_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT monitors_status_check CHECK ((status = ANY (ARRAY['unknown'::text, 'up'::text, 'down'::text]))),
    CONSTRAINT monitors_timeout_ms_check CHECK (((timeout_ms >= 1) AND (timeout_ms <= 30000))),
    CONSTRAINT monitors_url_check CHECK ((url ~ '^https?://'::text))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    github_id bigint NOT NULL,
    username text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: alert_channels alert_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_channels
    ADD CONSTRAINT alert_channels_pkey PRIMARY KEY (id);


--
-- Name: check_runs check_runs_monitor_scheduled_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_runs
    ADD CONSTRAINT check_runs_monitor_scheduled_at_key UNIQUE (monitor_id, scheduled_at);


--
-- Name: check_runs check_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_runs
    ADD CONSTRAINT check_runs_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: monitor_headers monitor_headers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitor_headers
    ADD CONSTRAINT monitor_headers_pkey PRIMARY KEY (id);


--
-- Name: monitors monitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitors
    ADD CONSTRAINT monitors_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_github_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_github_id_key UNIQUE (github_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: alert_channels_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_channels_user_id_idx ON public.alert_channels USING btree (user_id);


--
-- Name: incidents_monitor_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incidents_monitor_started_at_idx ON public.incidents USING btree (monitor_id, started_at DESC);


--
-- Name: incidents_one_open_per_monitor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incidents_one_open_per_monitor_idx ON public.incidents USING btree (monitor_id) WHERE (resolved_at IS NULL);


--
-- Name: monitor_headers_monitor_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX monitor_headers_monitor_name_idx ON public.monitor_headers USING btree (monitor_id, lower(name));


--
-- Name: monitors_next_run_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monitors_next_run_at_idx ON public.monitors USING btree (next_run_at) WHERE (NOT paused);


--
-- Name: monitors_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monitors_user_id_idx ON public.monitors USING btree (user_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: alert_channels alert_channels_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_channels
    ADD CONSTRAINT alert_channels_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: check_runs check_runs_monitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_runs
    ADD CONSTRAINT check_runs_monitor_id_fkey FOREIGN KEY (monitor_id) REFERENCES public.monitors(id) ON DELETE CASCADE;


--
-- Name: incidents incidents_monitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_monitor_id_fkey FOREIGN KEY (monitor_id) REFERENCES public.monitors(id) ON DELETE CASCADE;


--
-- Name: monitor_headers monitor_headers_monitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitor_headers
    ADD CONSTRAINT monitor_headers_monitor_id_fkey FOREIGN KEY (monitor_id) REFERENCES public.monitors(id) ON DELETE CASCADE;


--
-- Name: monitors monitors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitors
    ADD CONSTRAINT monitors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261001021930'),
    ('20261013184239'),
    ('20261015204052'),
    ('20261017014837'),
    ('20261017014838'),
    ('20261017014839'),
    ('20261017014840');
